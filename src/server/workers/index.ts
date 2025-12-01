import { Pool } from "pg"
import { initJobQueue, stopJobQueue } from "../lib/job-queue"
import { EmbeddingWorker } from "./embedding-worker"
import { ClassificationWorker } from "./classification-worker"
import { AriadneWorker, queueAriadneResponse } from "./ariadne-worker"
import { AriadneTrigger } from "./ariadne-trigger"
import { EnrichmentWorker } from "./enrichment-worker"
import { AgentSessionService } from "../services/agent-session-service"
import { StreamService } from "../services/stream-service"
import { checkOllamaHealth, ensureOllamaModels } from "../lib/ollama"
import { logger } from "../lib/logger"

let embeddingWorker: EmbeddingWorker | null = null
let classificationWorker: ClassificationWorker | null = null
let ariadneWorker: AriadneWorker | null = null
let ariadneTrigger: AriadneTrigger | null = null
let enrichmentWorker: EnrichmentWorker | null = null

/**
 * Initialize and start all AI workers.
 * Call this after database connection is established.
 */
export async function startWorkers(pool: Pool, connectionString: string): Promise<void> {
  logger.info("Initializing AI workers...")

  // Initialize job queue
  await initJobQueue(connectionString)

  // Check Ollama availability (non-blocking)
  const ollamaHealth = await checkOllamaHealth()
  if (ollamaHealth.available) {
    logger.info(
      {
        classificationModel: ollamaHealth.classificationModelLoaded,
        embeddingModel: ollamaHealth.embeddingModelLoaded,
      },
      "Ollama is available",
    )
    // Pull missing models in background
    if (!ollamaHealth.classificationModelLoaded || !ollamaHealth.embeddingModelLoaded) {
      ensureOllamaModels().catch((err) => {
        logger.warn({ err }, "Failed to pull Ollama models")
      })
    }
  } else {
    logger.warn(
      { error: ollamaHealth.error },
      "Ollama not available - will use API fallback for embeddings and classification",
    )
  }

  // Create AriadneTrigger first since AriadneWorker depends on it
  ariadneTrigger = new AriadneTrigger(pool)

  // Create worker instances
  embeddingWorker = new EmbeddingWorker(pool)
  classificationWorker = new ClassificationWorker(pool)
  ariadneWorker = new AriadneWorker(pool, ariadneTrigger)
  enrichmentWorker = new EnrichmentWorker(pool)

  // Start workers
  await embeddingWorker.start()
  await classificationWorker.start()
  await ariadneWorker.start()
  await ariadneTrigger.start()
  await enrichmentWorker.start()

  // Recover orphaned Ariadne sessions from previous server instance
  await recoverOrphanedSessions(pool)

  logger.info("AI workers started successfully")
}

/**
 * Recover orphaned Ariadne sessions that were interrupted by a server restart.
 * Re-queues jobs for active sessions so they can continue.
 */
async function recoverOrphanedSessions(pool: Pool): Promise<void> {
  const sessionService = new AgentSessionService(pool)
  const streamService = new StreamService(pool)

  const activeSessions = await sessionService.getActiveSessions()

  if (activeSessions.length === 0) {
    logger.debug("No orphaned Ariadne sessions to recover")
    return
  }

  logger.info({ count: activeSessions.length }, "🔄 Found orphaned Ariadne sessions, attempting recovery...")

  for (const session of activeSessions) {
    try {
      // Get the triggering event to reconstruct the job data
      const triggeringEvent = await streamService.getEventWithDetails(session.triggeringEventId)

      if (!triggeringEvent) {
        logger.warn(
          { sessionId: session.id, eventId: session.triggeringEventId },
          "Cannot recover session - triggering event not found",
        )
        await sessionService.updateStatus(session.id, "failed", "Recovery failed: triggering event not found")
        continue
      }

      // Determine the mode based on stream type
      const stream = await streamService.getStream(triggeringEvent.streamId)
      const mode = stream?.streamType === "thinking_space" ? "thinking_partner" : "retrieval"

      // Reset the session for recovery - clears old steps to prevent duplicates
      await sessionService.resetForRecovery(session.id)

      // Re-queue the job - the worker will detect the existing session and continue
      await queueAriadneResponse({
        workspaceId: session.workspaceId,
        streamId: triggeringEvent.streamId,
        eventId: session.triggeringEventId,
        mentionedBy: triggeringEvent.actorId || "",
        question: triggeringEvent.content || "",
        mode: mode as "retrieval" | "thinking_partner",
      })

      logger.info(
        { sessionId: session.id, streamId: session.streamId, triggeringEventId: session.triggeringEventId },
        "✅ Re-queued orphaned session for recovery",
      )
    } catch (err) {
      logger.error({ err, sessionId: session.id }, "Failed to recover orphaned session")
      await sessionService.updateStatus(
        session.id,
        "failed",
        "Recovery failed: " + (err instanceof Error ? err.message : "Unknown error"),
      )
    }
  }
}

/**
 * Stop all workers gracefully.
 */
export async function stopWorkers(): Promise<void> {
  logger.info("Stopping AI workers...")

  if (ariadneTrigger) {
    await ariadneTrigger.stop()
    ariadneTrigger = null
  }

  await stopJobQueue()

  embeddingWorker = null
  classificationWorker = null
  ariadneWorker = null
  enrichmentWorker = null

  logger.info("AI workers stopped")
}

// Re-export utilities
export { queueEmbedding, backfillEmbeddings } from "./embedding-worker"
export { maybeQueueClassification, shouldClassifyStream } from "./classification-worker"
export { queueAriadneResponse } from "./ariadne-worker"
export {
  queueEnrichment,
  queueEnrichmentForThreadParent,
  queueEnrichmentForThreadReply,
  queueEnrichmentForReaction,
  queueEnrichmentForRetrieval,
} from "./enrichment-worker"
