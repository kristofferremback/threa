import { Pool } from "pg"
import { initJobQueue, stopJobQueue } from "../lib/job-queue"
import { startEmbeddingWorker } from "./embedding-worker"
import { startClassificationWorker } from "./classification-worker"
import { checkOllamaHealth, ensureClassificationModel } from "../lib/ollama"
import { logger } from "../lib/logger"

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
    logger.info({ modelLoaded: ollamaHealth.modelLoaded }, "Ollama is available")
    if (!ollamaHealth.modelLoaded) {
      // Pull model in background
      ensureClassificationModel().catch((err) => {
        logger.warn({ err }, "Failed to pull classification model")
      })
    }
  } else {
    logger.warn(
      { error: ollamaHealth.error },
      "Ollama not available - classification will use API fallback only",
    )
  }

  // Start workers
  await startEmbeddingWorker(pool)
  await startClassificationWorker(pool)

  logger.info("AI workers started successfully")
}

/**
 * Stop all workers gracefully.
 */
export async function stopWorkers(): Promise<void> {
  logger.info("Stopping AI workers...")
  await stopJobQueue()
  logger.info("AI workers stopped")
}

// Re-export utilities
export { queueEmbedding, backfillEmbeddings } from "./embedding-worker"
export { maybeQueueClassification, shouldClassifyStream } from "./classification-worker"

