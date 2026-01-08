import type { Pool } from "pg"
import { withClient } from "../db"
import type { EmbeddingJobData, JobHandler } from "../lib/job-queue"
import { MessageRepository } from "../repositories/message-repository"
import type { EmbeddingServiceLike } from "../services/embedding-service"
import { logger } from "../lib/logger"

export interface EmbeddingWorkerDeps {
  pool: Pool
  embeddingService: EmbeddingServiceLike
}

/**
 * Create the embedding job handler for pg-boss.
 *
 * Generates embeddings for messages and stores them in the database.
 * Embeddings are used for semantic search.
 */
export function createEmbeddingWorker(deps: EmbeddingWorkerDeps): JobHandler<EmbeddingJobData> {
  const { pool, embeddingService } = deps

  return async (job) => {
    const { messageId, workspaceId } = job.data

    logger.info({ jobId: job.id, messageId, workspaceId }, "Processing embedding job")

    await withClient(pool, async (client) => {
      // Get the message content
      const message = await MessageRepository.findById(client, messageId)

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
      if (message.content.trim().length < 10) {
        logger.debug({ messageId }, "Skipping embedding for very short message")
        return
      }

      // Generate embedding (with cost tracking context)
      const embedding = await embeddingService.embed(message.content, {
        workspaceId,
        functionId: "message-embedding",
      })

      // Store embedding
      await MessageRepository.updateEmbedding(client, messageId, embedding)

      logger.info({ jobId: job.id, messageId }, "Embedding generated and stored")
    })
  }
}
