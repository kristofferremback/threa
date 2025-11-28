import { Pool } from "pg"
import { initJobQueue, stopJobQueue } from "../lib/job-queue"
import { startEmbeddingWorker } from "./embedding-worker"
import { startClassificationWorker } from "./classification-worker"
import { startAriadneWorker } from "./ariadne-worker"
import { startAriadneTrigger, stopAriadneTrigger } from "./ariadne-trigger"
import { checkOllamaHealth, ensureOllamaModels } from "../lib/ollama"
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

  // Start workers
  await startEmbeddingWorker(pool)
  await startClassificationWorker(pool)
  await startAriadneWorker(pool)

  // Start Ariadne trigger (Redis subscriber for async AI invocation)
  await startAriadneTrigger(pool)

  logger.info("AI workers started successfully")
}

/**
 * Stop all workers gracefully.
 */
export async function stopWorkers(): Promise<void> {
  logger.info("Stopping AI workers...")
  await stopAriadneTrigger()
  await stopJobQueue()
  logger.info("AI workers stopped")
}

// Re-export utilities
export { queueEmbedding, backfillEmbeddings } from "./embedding-worker"
export { maybeQueueClassification, shouldClassifyStream } from "./classification-worker"
export { queueAriadneResponse } from "./ariadne-worker"
