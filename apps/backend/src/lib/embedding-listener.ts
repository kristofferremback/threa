import type { Pool } from "pg"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import type { OutboxEvent, MessageCreatedOutboxPayload } from "../repositories/outbox-repository"
import { logger } from "./logger"

interface MessageCreatedEventPayload {
  messageId: string
}

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

      const payload = outboxEvent.payload as MessageCreatedOutboxPayload

      // Guard against malformed events (e.g., old events before migration)
      if (!payload.event?.payload) {
        logger.warn({ eventId: outboxEvent.id }, "Embedding listener: malformed event, skipping")
        return
      }

      const eventPayload = payload.event.payload as MessageCreatedEventPayload

      // Dispatch job to pg-boss for durable processing
      await jobQueue.send(JobQueues.EMBEDDING_GENERATE, {
        messageId: eventPayload.messageId,
      })

      logger.debug({ messageId: eventPayload.messageId }, "Embedding job dispatched")
    },
  })
}
