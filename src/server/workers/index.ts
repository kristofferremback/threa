import { Pool } from "pg"
import { initJobQueue, stopJobQueue } from "../lib/job-queue"
import { EmbeddingWorker } from "./embedding-worker"
import { ClassificationWorker } from "./classification-worker"
import { AriadneWorker } from "./ariadne-worker"
import { AriadneTrigger } from "./ariadne-trigger"
import { EnrichmentWorker } from "./enrichment-worker"
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

  logger.info("AI workers started successfully")
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
