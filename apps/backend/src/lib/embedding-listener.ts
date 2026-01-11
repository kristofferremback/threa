import type { PoolClient } from "pg"
import type { DatabasePools } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import type { OutboxEvent } from "../repositories/outbox-repository"
import { parseMessageCreatedPayloadWithClient } from "./outbox-payload-parsers"
import { logger } from "./logger"
import { job, type HandlerEffect } from "./handler-effects"

/**
 * Creates a listener that dispatches embedding generation jobs for new messages.
 *
 * Uses pure handler mode for guaranteed at-least-once delivery of pg-boss jobs.
 *
 * Flow:
 * 1. Message arrives (via outbox)
 * 2. Return pg-boss job effect for embedding generation
 *
 * Embedding generation runs async - messages are immediately searchable via
 * keyword search, and become semantically searchable once the embedding is ready.
 */
export function createEmbeddingListener(
  pools: DatabasePools,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "pureHandler" | "jobQueue" | "listenPool" | "queryPool">
): OutboxListener {
  return new OutboxListener({
    ...config,
    listenPool: pools.listen,
    queryPool: pools.main,
    listenerId: "embedding",
    jobQueue,
    pureHandler: async (outboxEvent: OutboxEvent, client: PoolClient): Promise<HandlerEffect[]> => {
      // Only process message:created events
      if (outboxEvent.eventType !== "message:created") {
        return []
      }

      const payload = await parseMessageCreatedPayloadWithClient(outboxEvent.payload, client)
      if (!payload) {
        logger.debug({ eventId: outboxEvent.id }, "Embedding listener: malformed event, skipping")
        return []
      }

      logger.debug({ messageId: payload.event.payload.messageId }, "Embedding job will be dispatched")

      // Return job effect - will be executed atomically with cursor update
      return [
        job(JobQueues.EMBEDDING_GENERATE, {
          messageId: payload.event.payload.messageId,
          workspaceId: payload.workspaceId,
        }),
      ]
    },
  })
}
