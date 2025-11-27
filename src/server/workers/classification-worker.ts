import { Pool } from "pg"
import { sql } from "../lib/db"
import { getJobQueue, ClassifyJobData, JobPriority } from "../lib/job-queue"
import { classifyWithSLM, estimateTokens as estimateSLMTokens } from "../lib/ollama"
import { classifyWithHaiku, calculateCost, Models } from "../lib/ai-providers"
import { AIUsageService } from "../services/ai-usage-service"
import { logger } from "../lib/logger"

interface ContentSignals {
  length: number
  hasCodeBlock: boolean
  hasInlineCode: boolean
  hasListItems: boolean
  hasLinks: boolean
  lineCount: number
}

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
  }
}

/**
 * Calculate a structural score to determine if content is worth classifying.
 * Uses only language-agnostic signals.
 */
function calculateStructuralScore(signals: ContentSignals, reactionCount?: number): number {
  return (
    (signals.length > 200 ? 1 : 0) +
    (signals.hasCodeBlock ? 2 : 0) +
    (signals.hasInlineCode ? 1 : 0) +
    (signals.hasListItems ? 2 : 0) +
    (signals.hasLinks ? 1 : 0) +
    (signals.lineCount > 3 ? 1 : 0) +
    (reactionCount && reactionCount >= 3 ? 1 : 0) +
    (reactionCount && reactionCount >= 5 ? 1 : 0)
  )
}

/**
 * Start the classification worker.
 * Uses SLM (granite4:350m) first, escalates to Haiku for uncertain cases.
 */
export async function startClassificationWorker(pool: Pool): Promise<void> {
  const boss = getJobQueue()
  const usageService = new AIUsageService(pool)

  logger.info("Starting classification worker")

  await boss.work<ClassifyJobData>(
    "ai.classify",
    {
      pollingIntervalSeconds: 5,
    },
    async (job) => {
      const { workspaceId, streamId, eventId, content, contentType, reactionCount } = job.data

      try {
        // Check if AI is enabled
        const isEnabled = await usageService.isAIEnabled(workspaceId)
        if (!isEnabled) {
          logger.debug({ workspaceId }, "AI not enabled, skipping classification")
          return
        }

        // Pre-filter with structural signals
        const signals = getContentSignals(content)
        const structuralScore = calculateStructuralScore(signals, reactionCount)

        if (structuralScore < 2) {
          logger.debug(
            { streamId, eventId, structuralScore },
            "Content failed structural pre-filter",
          )
          await updateClassificationResult(pool, streamId, eventId, "not_applicable")
          return
        }

        // Try SLM classification first (free, fast)
        const slmResult = await classifyWithSLM(content)

        // Track SLM usage (cost = 0 for local model)
        await usageService.trackUsage({
          workspaceId,
          jobType: "classify",
          model: "granite4:350m",
          inputTokens: estimateSLMTokens(content),
          costCents: 0,
          streamId,
          eventId,
          jobId: job.id,
        })

        if (slmResult.confident) {
          // SLM was confident - use its result
          const result = slmResult.isKnowledge ? "knowledge_candidate" : "not_applicable"
          await updateClassificationResult(pool, streamId, eventId, result)

          if (slmResult.isKnowledge) {
            await emitKnowledgeSuggestion(pool, streamId, eventId)
          }

          logger.info(
            { streamId, eventId, result, model: "granite4:350m" },
            "Classification complete (SLM)",
          )
          return
        }

        // SLM uncertain - escalate to Haiku
        logger.debug({ streamId, eventId }, "SLM uncertain, escalating to Haiku")

        const haikuResult = await classifyWithHaiku(content, reactionCount)

        // Track Haiku usage
        await usageService.trackUsage({
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

        const result = haikuResult.isKnowledge ? "knowledge_candidate" : "not_applicable"
        await updateClassificationResult(
          pool,
          streamId,
          eventId,
          result,
          haikuResult.suggestedTitle,
        )

        if (haikuResult.isKnowledge && haikuResult.confidence > 0.8) {
          await emitKnowledgeSuggestion(pool, streamId, eventId, haikuResult.suggestedTitle)
        }

        logger.info(
          {
            streamId,
            eventId,
            result,
            confidence: haikuResult.confidence,
            model: "claude-haiku",
          },
          "Classification complete (Haiku fallback)",
        )
      } catch (err) {
        logger.error({ err, streamId, eventId }, "Classification failed")
        throw err // Re-throw to trigger retry
      }
    },
  )
}

/**
 * Update classification result in the database.
 */
async function updateClassificationResult(
  pool: Pool,
  streamId: string | undefined,
  eventId: string | undefined,
  result: "knowledge_candidate" | "not_applicable",
  suggestedTitle?: string | null,
): Promise<void> {
  if (streamId) {
    await pool.query(
      sql`UPDATE streams
        SET last_classified_at = NOW(),
            classification_result = ${result},
            metadata = COALESCE(metadata, '{}') || ${JSON.stringify(
              suggestedTitle ? { suggestedKnowledgeTitle: suggestedTitle } : {},
            )}::jsonb
        WHERE id = ${streamId}`,
    )
  }
  // For single messages, we could store in stream_events.payload
  // but for now we only classify threads
}

/**
 * Emit a knowledge suggestion event in the stream.
 * This creates a hint in the UI that knowledge extraction is recommended.
 */
async function emitKnowledgeSuggestion(
  pool: Pool,
  streamId: string | undefined,
  eventId: string | undefined,
  suggestedTitle?: string | null,
): Promise<void> {
  // For now, we just update the stream metadata
  // In the future, we could emit a WebSocket event or create a system event
  if (streamId) {
    await pool.query(
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

/**
 * Queue a classification job with debouncing logic.
 */
export async function maybeQueueClassification(params: {
  workspaceId: string
  streamId?: string
  eventId?: string
  content: string
  contentType: "thread" | "message"
  reactionCount?: number
  forceClassify?: boolean
}): Promise<string | null> {
  const boss = getJobQueue()

  // Pre-filter check
  if (!params.forceClassify) {
    const signals = getContentSignals(params.content)
    const score = calculateStructuralScore(signals, params.reactionCount)

    if (score < 3) {
      logger.debug(
        { streamId: params.streamId, eventId: params.eventId, score },
        "Content doesn't meet structural threshold",
      )
      return null
    }
  }

  return await boss.send<ClassifyJobData>(
    "ai.classify",
    {
      workspaceId: params.workspaceId,
      streamId: params.streamId,
      eventId: params.eventId,
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

  // Only classify threads
  if (stream.stream_type !== "thread") {
    return { shouldClassify: false, reason: "Only threads are classified" }
  }

  // Already extracted knowledge
  if (stream.knowledge_extracted_at) {
    return { shouldClassify: false, reason: "Knowledge already extracted" }
  }

  // Check minimum message count (5+)
  const eventCount = parseInt(stream.event_count, 10)
  if (eventCount < 5) {
    return { shouldClassify: false, reason: `Only ${eventCount} messages (need 5+)` }
  }

  // Check classification cooldown (24 hours)
  if (stream.last_classified_at) {
    const hoursSinceClassified =
      (Date.now() - stream.last_classified_at.getTime()) / (1000 * 60 * 60)
    if (hoursSinceClassified < 24) {
      return {
        shouldClassify: false,
        reason: `Classified ${hoursSinceClassified.toFixed(1)} hours ago (need 24+)`,
      }
    }
  }

  // Check activity cooldown (1 hour since last message)
  if (stream.last_event_at) {
    const hoursSinceActivity =
      (Date.now() - stream.last_event_at.getTime()) / (1000 * 60 * 60)
    if (hoursSinceActivity < 1) {
      return {
        shouldClassify: false,
        reason: `Activity ${(hoursSinceActivity * 60).toFixed(0)} minutes ago (need 60+)`,
      }
    }
  }

  return { shouldClassify: true, reason: "Ready for classification" }
}

