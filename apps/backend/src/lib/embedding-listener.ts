import { type DatabasePools } from "../db"
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
  pools: DatabasePools,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler" | "listenPool" | "queryPool">
): OutboxListener {
  return new OutboxListener({
    ...config,
    listenPool: pools.listen,
    queryPool: pools.main,
    listenerId: "embedding",
    handler: async (outboxEvent: OutboxEvent) => {
      // Only process message:created events
      if (outboxEvent.eventType !== "message:created") {
        return
      }

      const payload = await parseMessageCreatedPayload(outboxEvent.payload, pools.main)
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
