import type { Pool } from "pg"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import type { OutboxEvent } from "../repositories/outbox-repository"
import { parseMessageCreatedPayload } from "./outbox-payload-parsers"
import { logger } from "./logger"

/**
 * Creates a listener that dispatches embedding generation jobs for new messages.
 *
 * Flow:
 * 1. Message arrives (via outbox)
 * 2. Dispatch job to pg-boss for embedding generation
 *
 * Embedding generation runs async - messages are immediately searchable via
 * keyword search, and become semantically searchable once the embedding is ready.
 */
export function createEmbeddingListener(
  pool: Pool,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler">
): OutboxListener {
  return new OutboxListener(pool, {
    ...config,
    listenerId: "embedding",
    handler: async (outboxEvent: OutboxEvent) => {
      // Only process message:created events
      if (outboxEvent.eventType !== "message:created") {
        return
      }

      const payload = await parseMessageCreatedPayload(outboxEvent.payload, pool)
      if (!payload) {
        logger.debug({ eventId: outboxEvent.id }, "Embedding listener: malformed event, skipping")
        return
      }

      // Dispatch job to pg-boss for durable processing
      await jobQueue.send(JobQueues.EMBEDDING_GENERATE, {
        messageId: payload.event.payload.messageId,
        workspaceId: payload.workspaceId,
      })

      logger.debug({ messageId: payload.event.payload.messageId }, "Embedding job dispatched")
    },
  })
}
