import { Pool } from "pg"
import { getJobQueue, CreateMemoJobData, JobPriority } from "../lib/job-queue"
import { MemoService } from "../services/memo-service"
import { MemoScoringService } from "../services/memo-scoring-service"
import { MemoRevisionService } from "../services/memo-revision-service"
import { MemoEvolutionService } from "../services/memo-evolution"
import { AIUsageService } from "../services/ai-usage-service"
import { logger } from "../lib/logger"

/**
 * MemoWorker - Processes memo creation jobs.
 *
 * Listens for memory.create-memo jobs and evaluates messages for memo-worthiness.
 * Uses the scoring service to determine if content should become a memo, and the
 * evolution service to handle overlap with existing memos using event embeddings.
 */
export class MemoWorker {
  private memoService: MemoService
  private scoringService: MemoScoringService
  private revisionService: MemoRevisionService
  private evolutionService: MemoEvolutionService
  private usageService: AIUsageService
  private isRunning = false

  constructor(private pool: Pool) {
    this.memoService = new MemoService(pool)
    this.scoringService = new MemoScoringService(pool)
    this.revisionService = new MemoRevisionService(pool)
    this.evolutionService = new MemoEvolutionService(pool)
    this.usageService = new AIUsageService(pool)
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Memo worker already running")
      return
    }

    logger.info("Starting memo worker")

    const boss = getJobQueue()

    await boss.work<CreateMemoJobData>(
      "memory.create-memo",
      {
        batchSize: 1,
        pollingIntervalSeconds: 5,
      },
      async (jobs) => {
        for (const job of jobs) {
          await this.processJob(job)
        }
      },
    )

    this.isRunning = true
    logger.info("Memo worker started")
  }

  private async processJob(job: { id: string; data: CreateMemoJobData }): Promise<void> {
    const { workspaceId, anchorEventIds, streamId, source } = job.data
    const eventId = anchorEventIds[0]

    logger.info({ jobId: job.id, eventId, source }, "📋 Memo creation job started")

    try {
      // Check if AI is enabled for workspace
      const isEnabled = await this.usageService.isAIEnabled(workspaceId)
      if (!isEnabled) {
        logger.info({ workspaceId }, "⏭️ AI not enabled for workspace, skipping memo creation")
        return
      }

      // Get message with context
      const message = await this.scoringService.getMessageWithContext(eventId)
      if (!message) {
        logger.warn({ eventId }, "❌ Message not found for memo evaluation")
        return
      }

      // Skip AI-generated messages - we only want human knowledge in memos
      if (message.isAiGenerated) {
        logger.info({ eventId }, "⏭️ Skipping AI-generated message for memo creation")
        return
      }

      // Calculate memo-worthiness score
      const worthiness = await this.scoringService.score(message)

      logger.info(
        {
          eventId,
          score: worthiness.score,
          shouldCreateMemo: worthiness.shouldCreateMemo,
          reasons: worthiness.reasons.slice(0, 3),
        },
        "📊 Memo worthiness evaluated",
      )

      if (!worthiness.shouldCreateMemo) {
        logger.info(
          { eventId, score: worthiness.score },
          "⏭️ Message not memo-worthy, skipping",
        )
        return
      }

      // Evaluate for memo evolution (uses event-to-event embedding comparison)
      const evolution = await this.evolutionService.evaluateForEvolution(
        workspaceId,
        eventId,
        message.content,
      )

      logger.info(
        {
          eventId,
          action: evolution.action,
          targetMemoId: evolution.targetMemoId,
          similarity: evolution.similarity,
          llmVerified: evolution.llmVerified,
          reasoning: evolution.reasoning,
        },
        "🔍 Evolution analysis complete",
      )

      // Handle based on evolution decision
      switch (evolution.action) {
        case "skip":
          logger.info(
            { eventId, targetMemoId: evolution.targetMemoId },
            "⏭️ Skipping - similar memo already exists",
          )
          return

        case "reinforce":
          if (evolution.targetMemoId) {
            await this.evolutionService.reinforceMemo(
              evolution.targetMemoId,
              eventId,
              evolution.similarity,
              evolution.llmVerified,
            )
            logger.info(
              { eventId, targetMemoId: evolution.targetMemoId, similarity: evolution.similarity },
              "🔗 Reinforced existing memo with new event",
            )
          }
          return

        case "supersede":
          if (evolution.targetMemoId) {
            const supersedeSummary = await this.scoringService.generateSummary(message.content, {
              streamName: message.streamName,
              authorName: message.authorName,
            })

            const supersedeTopics = await this.scoringService.suggestTopics(workspaceId, message.content)
            const supersedeCategory = await this.scoringService.classifyCategory(message.content)

            const newMemo = await this.revisionService.supersedeMemo(evolution.targetMemoId, {
              workspaceId,
              anchorEventIds: [eventId],
              streamId: message.streamId,
              summary: supersedeSummary,
              topics: supersedeTopics,
              category: supersedeCategory || undefined,
              confidence: worthiness.confidence,
            })

            // Record original anchor for the new memo
            await this.evolutionService.recordOriginalAnchor(newMemo.id, eventId)

            if (supersedeTopics.length > 0) {
              await this.scoringService.recordTagUsage(workspaceId, supersedeTopics)
            }

            logger.info(
              { eventId, oldMemoId: evolution.targetMemoId, newMemoId: newMemo.id },
              "🔄 Superseded old memo with new one",
            )
          }
          return

        case "create_new":
        default:
          // Generate summary for new memo
          const summary = await this.scoringService.generateSummary(message.content, {
            streamName: message.streamName,
            authorName: message.authorName,
          })

          // Generate topics using LLM with existing workspace tags as context
          const topics = await this.scoringService.suggestTopics(workspaceId, message.content)

          // Classify memo category
          const category = await this.scoringService.classifyCategory(message.content)

          // Create new memo
          const memo = await this.memoService.createMemo({
            workspaceId,
            anchorEventIds: [eventId],
            streamId: message.streamId,
            source: source || "system",
            summary,
            topics,
            category: category || undefined,
            confidence: worthiness.confidence,
          })

          // Record original anchor in reinforcement tracking
          await this.evolutionService.recordOriginalAnchor(memo.id, eventId)

          // Record tag usage to update workspace tags
          if (topics.length > 0) {
            await this.scoringService.recordTagUsage(workspaceId, topics)
          }

          logger.info(
            {
              memoId: memo.id,
              eventId,
              summary: memo.summary,
              topics: memo.topics,
              category: memo.category,
              confidence: memo.confidence,
            },
            "✅ New memo created",
          )
          return
      }
    } catch (err) {
      logger.error({ err, eventId }, "❌ Memo creation job failed")
      throw err
    }
  }
}

/**
 * Queue a memo evaluation job for an event.
 */
export async function queueMemoEvaluation(params: {
  workspaceId: string
  eventId: string
  textMessageId: string
  source?: "system" | "enrichment" | "classification"
}): Promise<string | null> {
  const boss = getJobQueue()

  return await boss.send<CreateMemoJobData>(
    "memory.create-memo",
    {
      workspaceId: params.workspaceId,
      anchorEventIds: [params.eventId],
      streamId: "", // Will be looked up from event
      source: "system",
    },
    {
      priority: JobPriority.BACKGROUND,
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      // Dedupe by event ID - only evaluate each message once
      singletonKey: `memo-eval-${params.eventId}`,
      singletonSeconds: 86400, // 24 hour window
    },
  )
}

/**
 * Backfill memo evaluation for existing enriched messages.
 */
export async function backfillMemoEvaluation(
  pool: Pool,
  workspaceId: string,
  options: { limit?: number } = {},
): Promise<{ queued: number }> {
  const limit = options.limit ?? 500

  // Find enriched messages that aren't already anchored in memos
  const result = await pool.query<{
    event_id: string
    text_message_id: string
  }>(
    `SELECT e.id as event_id, tm.id as text_message_id
     FROM stream_events e
     INNER JOIN text_messages tm ON e.content_id = tm.id AND e.content_type = 'text_message'
     INNER JOIN streams s ON e.stream_id = s.id
     LEFT JOIN memos m ON e.id = ANY(m.anchor_event_ids) AND m.archived_at IS NULL
     WHERE s.workspace_id = $1
       AND tm.enrichment_tier >= 2
       AND e.deleted_at IS NULL
       AND m.id IS NULL
     ORDER BY e.created_at DESC
     LIMIT $2`,
    [workspaceId, limit],
  )

  let queued = 0

  for (const row of result.rows) {
    const jobId = await queueMemoEvaluation({
      workspaceId,
      eventId: row.event_id,
      textMessageId: row.text_message_id,
      source: "system",
    })

    if (jobId) {
      queued++
    }
  }

  logger.info(
    { workspaceId, queued, total: result.rows.length },
    "Backfill memo evaluation jobs queued",
  )
  return { queued }
}
