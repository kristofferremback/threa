import type { Pool } from "pg"
import type { EmbeddingJobData, JobHandler } from "../../lib/job-queue"
import { MessageRepository } from "../../repositories"
import type { EmbeddingServiceLike } from "./embedding-service"
import { logger } from "../../lib/logger"

export interface EmbeddingWorkerDeps {
  pool: Pool
  embeddingService: EmbeddingServiceLike
}

/**
 * Create the embedding job handler for queue system.
 *
 * Generates embeddings for messages and stores them in the database.
 * Embeddings are used for semantic search.
 *
 * IMPORTANT: Uses three-phase pattern (INV-41) to avoid holding database
 * connections during AI calls (embedding generation can take 200-500ms):
 *
 * Phase 1: Fetch message (single query, ~10-50ms)
 * Phase 2: Generate embedding with no connection held (200-500ms)
 * Phase 3: Save embedding (single query, ~10-50ms)
 */
export function createEmbeddingWorker(deps: EmbeddingWorkerDeps): JobHandler<EmbeddingJobData> {
  const { pool, embeddingService } = deps

  return async (job) => {
    const { messageId, workspaceId } = job.data

    logger.info({ jobId: job.id, messageId, workspaceId }, "Processing embedding job")

    // Phase 1: Fetch message (single query, INV-30)
    const message = await MessageRepository.findById(pool, messageId)

    if (!message) {
      logger.warn({ messageId }, "Message not found for embedding generation")
      return
    }

    // Skip if message was deleted
    if (message.deletedAt) {
      logger.debug({ messageId }, "Skipping embedding for deleted message")
      return
    }

    // Skip very short messages (unlikely to be useful for semantic search)
    if (message.contentMarkdown.trim().length < 10) {
      logger.debug({ messageId }, "Skipping embedding for very short message")
      return
    }

    // Phase 2: Generate embedding (no DB connection held, 200-500ms)
    const embedding = await embeddingService.embed(message.contentMarkdown, {
      workspaceId,
      functionId: "message-embedding",
    })

    // Phase 3: Save embedding (single query, INV-30)
    await MessageRepository.updateEmbedding(pool, messageId, embedding)

    logger.info({ jobId: job.id, messageId }, "Embedding generated and stored")
  }
}
