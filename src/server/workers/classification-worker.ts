import { Pool } from "pg"
import { sql } from "../lib/db"
import { getJobQueue, ClassifyJobData, JobPriority } from "../lib/job-queue"
import { classifyWithSLM, estimateTokens as estimateSLMTokens } from "../lib/ollama"
import { classifyWithHaiku, calculateCost, Models } from "../lib/ai-providers"
import { AIUsageService } from "../services/ai-usage-service"
import { logger } from "../lib/logger"
import { queueEnrichment } from "./enrichment-worker"

interface ContentSignals {
  length: number
  hasCodeBlock: boolean
  hasInlineCode: boolean
  hasListItems: boolean
  hasLinks: boolean
  lineCount: number
  isAnnouncement: boolean
  isExplanation: boolean
  isDecision: boolean
  hasKnowledgeEmoji: boolean
}

// Patterns that indicate an announcement
const ANNOUNCEMENT_PATTERNS = [
  /\b(we('ve|'re| have| are| just)|i('ve| have| just))\s+(implemented|launched|shipped|released|deployed|built|created|added|introduced|finished|completed)/i,
  /\b(introducing|announcing|new feature|just (launched|shipped|released|deployed))/i,
  /\bhey (all|everyone|team|folks),?\s+we/i,
  /\b(fyi|heads up|psa|update):?\s/i,
]

// Patterns that indicate an explanation
const EXPLANATION_PATTERNS = [
  /\b(for those (curious|wondering|interested)|here'?s (how|why|what)|let me explain|the (way|reason) (it|this|we))/i,
  /\b(basically|essentially|in (short|summary|essence)|to (summarize|explain)|this (means|is because))/i,
  /\binspired by\b/i,
  /\bworks by\b/i,
]

// Patterns that indicate a decision
const DECISION_PATTERNS = [
  /\b(we('ve)? decided|the decision (is|was)|going (with|forward with)|the plan is|we('re| are) going to)/i,
  /\b(after (discussing|consideration|review)|based on (feedback|discussion))/i,
]

// Emojis that often accompany knowledge-sharing
const KNOWLEDGE_EMOJIS = /[🤔💡📚📖ℹ️✨🎉🚀💭📝🔍]/

/**
 * Extract language-agnostic structural signals from content.
 */
function getContentSignals(content: string): ContentSignals {
  return {
    length: content.length,
    hasCodeBlock: /```[\s\S]*?```/.test(content),
    hasInlineCode: /`[^`]+`/.test(content),
    hasListItems: /^[\s]*[-*•]\s|^[\s]*\d+[.)]\s/m.test(content),
    hasLinks: /https?:\/\/\S+/.test(content),
    lineCount: content.split("\n").filter((l) => l.trim()).length,
    isAnnouncement: ANNOUNCEMENT_PATTERNS.some((p) => p.test(content)),
    isExplanation: EXPLANATION_PATTERNS.some((p) => p.test(content)),
    isDecision: DECISION_PATTERNS.some((p) => p.test(content)),
    hasKnowledgeEmoji: KNOWLEDGE_EMOJIS.test(content),
  }
}

/**
 * Calculate a structural score to determine if content is worth classifying.
 * Higher score = more likely to be valuable content.
 */
function calculateStructuralScore(signals: ContentSignals, reactionCount?: number): number {
  return (
    // Structural signals
    (signals.length > 200 ? 1 : 0) +
    (signals.length > 500 ? 1 : 0) +
    (signals.hasCodeBlock ? 2 : 0) +
    (signals.hasInlineCode ? 1 : 0) +
    (signals.hasListItems ? 2 : 0) +
    (signals.hasLinks ? 1 : 0) +
    (signals.lineCount > 3 ? 1 : 0) +
    // Content-type signals (high value - these indicate intentional knowledge sharing)
    (signals.isAnnouncement ? 3 : 0) +
    (signals.isExplanation ? 3 : 0) +
    (signals.isDecision ? 2 : 0) +
    (signals.hasKnowledgeEmoji ? 1 : 0) +
    // Social proof signals
    (reactionCount && reactionCount >= 3 ? 1 : 0) +
    (reactionCount && reactionCount >= 5 ? 1 : 0)
  )
}

/**
 * Classification Worker - Processes content classification jobs.
 *
 * Uses SLM (granite4:350m) first for fast/free classification,
 * then escalates to Haiku for uncertain cases.
 */
export class ClassificationWorker {
  private usageService: AIUsageService
  private isRunning = false

  constructor(private pool: Pool) {
    this.usageService = new AIUsageService(pool)
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Classification worker already running")
      return
    }

    logger.info("Starting classification worker")

    const boss = getJobQueue()

    await boss.work<ClassifyJobData>(
      "ai.classify",
      {
        pollingIntervalSeconds: 5,
      },
      async (job) => {
        await this.processJob(job)
      },
    )

    this.isRunning = true
    logger.info("Classification worker started")
  }

  private async processJob(job: { id: string; data: ClassifyJobData }): Promise<void> {
    const { workspaceId, streamId, eventId, textMessageId, content, reactionCount } = job.data

    logger.info(
      { jobId: job.id, streamId, eventId, contentLength: content.length, reactionCount },
      "📋 Classification job started",
    )

    try {
      const isEnabled = await this.usageService.isAIEnabled(workspaceId)
      if (!isEnabled) {
        logger.info({ workspaceId }, "⏭️ AI not enabled for workspace, skipping classification")
        return
      }

      const signals = getContentSignals(content)
      const structuralScore = calculateStructuralScore(signals, reactionCount)

      logger.info(
        {
          streamId,
          eventId,
          structuralScore,
          signals: {
            length: signals.length,
            hasCodeBlock: signals.hasCodeBlock,
            hasListItems: signals.hasListItems,
            isAnnouncement: signals.isAnnouncement,
            isExplanation: signals.isExplanation,
            isDecision: signals.isDecision,
          },
        },
        "📊 Structural analysis complete",
      )

      if (structuralScore < 2) {
        logger.info({ streamId, eventId, structuralScore }, "⏭️ Content failed structural pre-filter (score < 2)")
        await this.updateClassificationResult(streamId, eventId, "not_applicable")
        return
      }

      // Try SLM classification first (free, fast)
      logger.info({ streamId, eventId }, "🤖 Running SLM classification...")
      const slmResult = await classifyWithSLM(content)

      await this.usageService.trackUsage({
        workspaceId,
        jobType: "classify",
        model: "granite4:350m",
        inputTokens: estimateSLMTokens(content),
        costCents: 0,
        streamId,
        eventId,
        jobId: job.id,
      })

      logger.info(
        {
          streamId,
          eventId,
          isKnowledge: slmResult.isKnowledge,
          confident: slmResult.confident,
          rawResponse: slmResult.rawResponse.slice(0, 100),
        },
        "🤖 SLM classification result",
      )

      if (slmResult.confident) {
        const result = slmResult.isKnowledge ? "knowledge_candidate" : "not_applicable"
        await this.updateClassificationResult(streamId, eventId, result)

        if (slmResult.isKnowledge) {
          logger.info({ streamId, eventId }, "✅ Content identified as KNOWLEDGE - queueing enrichment")
          await this.emitKnowledgeSuggestion(streamId, eventId)
          // Queue enrichment for knowledge candidates
          if (textMessageId && eventId) {
            await this.queueEnrichmentForKnowledge(workspaceId, textMessageId, eventId, signals)
          }
        } else {
          logger.info({ streamId, eventId }, "❌ Content classified as NOT knowledge")
        }

        logger.info({ streamId, eventId, result, model: "granite4:350m" }, "📋 Classification complete (SLM)")
        return
      }

      // SLM uncertain - escalate to Haiku
      logger.info({ streamId, eventId }, "🔄 SLM uncertain, escalating to Haiku")

      const haikuResult = await classifyWithHaiku(content, reactionCount)

      await this.usageService.trackUsage({
        workspaceId,
        jobType: "classify",
        model: Models.CLAUDE_HAIKU,
        inputTokens: haikuResult.usage.inputTokens,
        outputTokens: haikuResult.usage.outputTokens,
        costCents: calculateCost(Models.CLAUDE_HAIKU, {
          inputTokens: haikuResult.usage.inputTokens,
          outputTokens: haikuResult.usage.outputTokens,
        }),
        streamId,
        eventId,
        jobId: job.id,
      })

      logger.info(
        {
          streamId,
          eventId,
          isKnowledge: haikuResult.isKnowledge,
          confidence: haikuResult.confidence,
          suggestedTitle: haikuResult.suggestedTitle,
        },
        "🤖 Haiku classification result",
      )

      const result = haikuResult.isKnowledge ? "knowledge_candidate" : "not_applicable"
      await this.updateClassificationResult(streamId, eventId, result, haikuResult.suggestedTitle)

      if (haikuResult.isKnowledge && haikuResult.confidence > 0.8) {
        logger.info(
          { streamId, eventId, confidence: haikuResult.confidence, suggestedTitle: haikuResult.suggestedTitle },
          "✅ High-confidence KNOWLEDGE detected - queueing enrichment",
        )
        await this.emitKnowledgeSuggestion(streamId, eventId, haikuResult.suggestedTitle)
        // Queue enrichment for high-confidence knowledge candidates
        if (textMessageId && eventId) {
          await this.queueEnrichmentForKnowledge(workspaceId, textMessageId, eventId, signals)
        }
      } else if (haikuResult.isKnowledge) {
        logger.info(
          { streamId, eventId, confidence: haikuResult.confidence },
          "🟡 Low-confidence knowledge - not queueing enrichment",
        )
      } else {
        logger.info({ streamId, eventId }, "❌ Haiku classified as NOT knowledge")
      }

      logger.info(
        { streamId, eventId, result, confidence: haikuResult.confidence, model: Models.CLAUDE_HAIKU },
        "📋 Classification complete (Haiku fallback)",
      )
    } catch (err) {
      logger.error({ err, streamId, eventId }, "Classification failed")
      throw err
    }
  }

  /**
   * Queue enrichment for content classified as knowledge.
   */
  private async queueEnrichmentForKnowledge(
    workspaceId: string,
    textMessageId: string,
    eventId: string,
    signals: ContentSignals,
  ): Promise<void> {
    try {
      await queueEnrichment({
        workspaceId,
        textMessageId,
        eventId,
        signals: {
          // Mark as "classified" to trigger enrichment regardless of reaction/reply count
          retrieved: true,
          helpful: true,
        },
      })
      logger.debug(
        { textMessageId, eventId, isAnnouncement: signals.isAnnouncement, isExplanation: signals.isExplanation },
        "Queued enrichment for classified knowledge",
      )
    } catch (err) {
      logger.warn({ err, textMessageId, eventId }, "Failed to queue enrichment for classified knowledge")
    }
  }

  private async updateClassificationResult(
    streamId: string | undefined,
    eventId: string | undefined,
    result: "knowledge_candidate" | "not_applicable",
    suggestedTitle?: string | null,
  ): Promise<void> {
    if (streamId) {
      await this.pool.query(
        sql`UPDATE streams
          SET last_classified_at = NOW(),
              classification_result = ${result},
              metadata = COALESCE(metadata, '{}') || ${JSON.stringify(
                suggestedTitle ? { suggestedKnowledgeTitle: suggestedTitle } : {},
              )}::jsonb
          WHERE id = ${streamId}`,
      )
    }
  }

  private async emitKnowledgeSuggestion(
    streamId: string | undefined,
    eventId: string | undefined,
    suggestedTitle?: string | null,
  ): Promise<void> {
    if (streamId) {
      await this.pool.query(
        sql`UPDATE streams
          SET metadata = COALESCE(metadata, '{}') || ${JSON.stringify({
            knowledgeSuggestion: {
              suggestedAt: new Date().toISOString(),
              suggestedTitle,
              sourceEventId: eventId,
            },
          })}::jsonb
          WHERE id = ${streamId}`,
      )
    }
  }
}

/**
 * Queue a classification job for a message.
 * Uses structural heuristics to pre-filter messages before sending to the LLM.
 */
export async function maybeQueueClassification(params: {
  workspaceId: string
  streamId?: string
  eventId?: string
  textMessageId?: string
  content: string
  contentType: "thread" | "message"
  reactionCount?: number
  forceClassify?: boolean
}): Promise<string | null> {
  const boss = getJobQueue()

  const signals = getContentSignals(params.content)
  const score = calculateStructuralScore(signals, params.reactionCount)

  logger.info(
    {
      streamId: params.streamId,
      eventId: params.eventId,
      contentType: params.contentType,
      contentLength: params.content.length,
      score,
      threshold: 3,
      signals: {
        isAnnouncement: signals.isAnnouncement,
        isExplanation: signals.isExplanation,
        isDecision: signals.isDecision,
        hasCodeBlock: signals.hasCodeBlock,
        hasListItems: signals.hasListItems,
      },
      forceClassify: params.forceClassify,
    },
    "🔍 maybeQueueClassification - evaluating content",
  )

  if (!params.forceClassify && score < 3) {
    logger.info(
      {
        streamId: params.streamId,
        eventId: params.eventId,
        score,
      },
      "⏭️ Content doesn't meet structural threshold (score < 3), NOT queueing",
    )
    return null
  }

  logger.info(
    {
      streamId: params.streamId,
      eventId: params.eventId,
      score,
    },
    "📤 Queueing message for classification",
  )

  return await boss.send<ClassifyJobData>(
    "ai.classify",
    {
      workspaceId: params.workspaceId,
      streamId: params.streamId,
      eventId: params.eventId,
      textMessageId: params.textMessageId,
      content: params.content,
      contentType: params.contentType,
      reactionCount: params.reactionCount,
    },
    {
      priority: JobPriority.LOW,
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
    },
  )
}

/**
 * Check if a stream should be classified based on debounce rules.
 */
export async function shouldClassifyStream(
  pool: Pool,
  streamId: string,
): Promise<{ shouldClassify: boolean; reason: string }> {
  const result = await pool.query<{
    stream_type: string
    last_classified_at: Date | null
    classification_result: string | null
    knowledge_extracted_at: Date | null
    event_count: string
    last_event_at: Date | null
  }>(
    sql`SELECT
      s.stream_type,
      s.last_classified_at,
      s.classification_result,
      s.knowledge_extracted_at,
      (SELECT COUNT(*) FROM stream_events WHERE stream_id = s.id AND deleted_at IS NULL)::text as event_count,
      (SELECT MAX(created_at) FROM stream_events WHERE stream_id = s.id AND deleted_at IS NULL) as last_event_at
    FROM streams s
    WHERE s.id = ${streamId}`,
  )

  if (result.rows.length === 0) {
    return { shouldClassify: false, reason: "Stream not found" }
  }

  const stream = result.rows[0]

  if (stream.stream_type !== "thread") {
    return { shouldClassify: false, reason: "Only threads are classified" }
  }

  if (stream.knowledge_extracted_at) {
    return { shouldClassify: false, reason: "Knowledge already extracted" }
  }

  const eventCount = parseInt(stream.event_count, 10)
  if (eventCount < 5) {
    return { shouldClassify: false, reason: `Only ${eventCount} messages (need 5+)` }
  }

  if (stream.last_classified_at) {
    const hoursSinceClassified = (Date.now() - stream.last_classified_at.getTime()) / (1000 * 60 * 60)
    if (hoursSinceClassified < 24) {
      return { shouldClassify: false, reason: `Classified ${hoursSinceClassified.toFixed(1)} hours ago (need 24+)` }
    }
  }

  if (stream.last_event_at) {
    const hoursSinceActivity = (Date.now() - stream.last_event_at.getTime()) / (1000 * 60 * 60)
    if (hoursSinceActivity < 1) {
      return {
        shouldClassify: false,
        reason: `Activity ${(hoursSinceActivity * 60).toFixed(0)} minutes ago (need 60+)`,
      }
    }
  }

  return { shouldClassify: true, reason: "Ready for classification" }
}
