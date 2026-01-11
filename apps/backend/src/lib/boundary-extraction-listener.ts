import type { PoolClient } from "pg"
import type { DatabasePools } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import type { OutboxEvent } from "../repositories/outbox-repository"
import { parseMessageCreatedPayloadWithClient } from "./outbox-payload-parsers"
import { AuthorTypes } from "@threa/types"
import { logger } from "./logger"
import { job, type HandlerEffect } from "./handler-effects"

/**
 * Creates a boundary extraction listener that dispatches jobs for messages
 * to detect conversational boundaries.
 *
 * Uses pure handler mode for guaranteed at-least-once delivery of pg-boss jobs.
 *
 * Flow:
 * 1. Message arrives (via outbox)
 * 2. Check if it's a user message (persona messages can be added later)
 * 3. Return pg-boss job effect for LLM processing
 */
export function createBoundaryExtractionListener(
  pools: DatabasePools,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "pureHandler" | "jobQueue" | "listenPool" | "queryPool">
): OutboxListener {
  return new OutboxListener({
    ...config,
    listenPool: pools.listen,
    queryPool: pools.main,
    listenerId: "boundary-extraction",
    jobQueue,
    pureHandler: async (outboxEvent: OutboxEvent, client: PoolClient): Promise<HandlerEffect[]> => {
      if (outboxEvent.eventType !== "message:created") {
        return []
      }

      const payload = await parseMessageCreatedPayloadWithClient(outboxEvent.payload, client)
      if (!payload) {
        logger.debug({ eventId: outboxEvent.id }, "Boundary extraction: malformed event, skipping")
        return []
      }

      const { streamId, workspaceId, event } = payload

      if (event.actorType !== AuthorTypes.USER) {
        return []
      }

      logger.debug({ streamId, messageId: event.payload.messageId }, "Boundary extraction job will be dispatched")

      // Return job effect - will be executed atomically with cursor update
      return [
        job(JobQueues.BOUNDARY_EXTRACT, {
          messageId: event.payload.messageId,
          streamId,
          workspaceId,
        }),
      ]
    },
  })
}
