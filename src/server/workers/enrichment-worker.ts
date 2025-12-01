import { Pool } from "pg"
import { getJobQueue, EnrichJobData, JobPriority } from "../lib/job-queue"
import { EnrichmentService } from "../services/enrichment-service"
import { AIUsageService } from "../services/ai-usage-service"
import { logger } from "../lib/logger"

/**
 * Enrichment Worker - Processes message enrichment jobs.
 *
 * Listens for memory.enrich jobs and generates contextual headers
 * for messages that have accumulated enough signals (reactions, replies, retrieval).
 *
 * This is part of the GAM-inspired memory system's lazy enrichment strategy.
 */
export class EnrichmentWorker {
  private enrichmentService: EnrichmentService
  private usageService: AIUsageService
  private isRunning = false

  constructor(private pool: Pool) {
    this.enrichmentService = new EnrichmentService(pool)
    this.usageService = new AIUsageService(pool)
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Enrichment worker already running")
      return
    }

    logger.info("Starting enrichment worker")

    const boss = getJobQueue()

    await boss.work<EnrichJobData>(
      "memory.enrich",
      {
        pollingIntervalSeconds: 5,
      },
      async (job) => {
        await this.processJob(job)
      },
    )

    this.isRunning = true
    logger.info("Enrichment worker started")
  }

  private async processJob(job: { id: string; data: EnrichJobData }): Promise<void> {
    const { workspaceId, textMessageId, eventId, signals } = job.data

    logger.info({ jobId: job.id, textMessageId, eventId, signals }, "📝 Enrichment job started")

    try {
      const isEnabled = await this.usageService.isAIEnabled(workspaceId)
      if (!isEnabled) {
        logger.info({ workspaceId }, "⏭️ AI not enabled for workspace, skipping enrichment")
        return
      }

      // Check if signals warrant enrichment
      if (!this.enrichmentService.shouldEnrich(signals)) {
        logger.info(
          { textMessageId, signals },
          "⏭️ Signals don't meet enrichment threshold (need: reactions>=2 OR replies>=2 OR retrieved)",
        )
        return
      }

      logger.info({ textMessageId, eventId, signals }, "🔄 Starting message enrichment...")

      // Perform enrichment
      const success = await this.enrichmentService.enrichMessage(textMessageId, eventId, signals)

      if (success) {
        logger.info({ textMessageId, signals }, "✅ Message enriched successfully")
      } else {
        logger.warn({ textMessageId }, "❌ Message enrichment failed")
      }
    } catch (err) {
      logger.error({ err, textMessageId, eventId }, "❌ Enrichment job failed")
      throw err
    }
  }
}

/**
 * Queue an enrichment job for a message.
 * Called when signals accumulate (reactions, replies, or retrieval).
 */
export async function queueEnrichment(params: {
  workspaceId: string
  textMessageId: string
  eventId: string
  signals: {
    reactions?: number
    replies?: number
    retrieved?: boolean
    helpful?: boolean
  }
}): Promise<string | null> {
  const boss = getJobQueue()

  // Quick pre-check - don't queue if signals are too low
  const signalSum = (params.signals.reactions ?? 0) + (params.signals.replies ?? 0)
  if (signalSum < 2 && !params.signals.retrieved) {
    return null
  }

  return await boss.send<EnrichJobData>(
    "memory.enrich",
    {
      workspaceId: params.workspaceId,
      textMessageId: params.textMessageId,
      eventId: params.eventId,
      signals: params.signals,
    },
    {
      priority: JobPriority.LOW,
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      // Use singletonKey to dedupe multiple signals for same message
      singletonKey: `enrich-${params.textMessageId}`,
      singletonSeconds: 300, // 5 minute window to batch signals
    },
  )
}

/**
 * Queue enrichment check for the parent event when a thread is created.
 */
export async function queueEnrichmentForThreadParent(params: {
  workspaceId: string
  parentEventId: string
  parentTextMessageId: string
}): Promise<string | null> {
  return queueEnrichment({
    workspaceId: params.workspaceId,
    textMessageId: params.parentTextMessageId,
    eventId: params.parentEventId,
    signals: { replies: 1 }, // Thread creation counts as first reply
  })
}

/**
 * Queue enrichment check when a message in a thread is created.
 * This increments the reply count for the thread's parent message.
 */
export async function queueEnrichmentForThreadReply(params: {
  workspaceId: string
  parentEventId: string
  parentTextMessageId: string
  replyCount: number
}): Promise<string | null> {
  return queueEnrichment({
    workspaceId: params.workspaceId,
    textMessageId: params.parentTextMessageId,
    eventId: params.parentEventId,
    signals: { replies: params.replyCount },
  })
}

/**
 * Queue enrichment check when a reaction is added.
 */
export async function queueEnrichmentForReaction(params: {
  workspaceId: string
  eventId: string
  textMessageId: string
  reactionCount: number
}): Promise<string | null> {
  return queueEnrichment({
    workspaceId: params.workspaceId,
    textMessageId: params.textMessageId,
    eventId: params.eventId,
    signals: { reactions: params.reactionCount },
  })
}

/**
 * Queue enrichment when Ariadne retrieves a message.
 */
export async function queueEnrichmentForRetrieval(params: {
  workspaceId: string
  eventId: string
  textMessageId: string
  helpful: boolean
}): Promise<string | null> {
  return queueEnrichment({
    workspaceId: params.workspaceId,
    textMessageId: params.textMessageId,
    eventId: params.eventId,
    signals: { retrieved: true, helpful: params.helpful },
  })
}
