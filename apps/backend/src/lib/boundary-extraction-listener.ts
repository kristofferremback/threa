import type { Pool } from "pg"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import type { OutboxEvent, MessageCreatedOutboxPayload } from "../repositories/outbox-repository"
import { AuthorTypes } from "@threa/types"
import { logger } from "./logger"

interface MessageCreatedEventPayload {
  messageId: string
}

/**
 * Creates a boundary extraction listener that dispatches jobs for messages
 * to detect conversational boundaries.
 *
 * Flow:
 * 1. Message arrives (via outbox)
 * 2. Check if it's a user message (persona messages can be added later)
 * 3. Dispatch durable job to pg-boss for LLM processing
 */
export function createBoundaryExtractionListener(
  pool: Pool,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler">
): OutboxListener {
  return new OutboxListener(pool, {
    ...config,
    listenerId: "boundary-extraction",
    handler: async (outboxEvent: OutboxEvent) => {
      if (outboxEvent.eventType !== "message:created") {
        return
      }

      const payload = outboxEvent.payload as MessageCreatedOutboxPayload
      const { event, streamId, workspaceId } = payload
      const eventPayload = event.payload as MessageCreatedEventPayload

      if (event.actorType !== AuthorTypes.USER) {
        return
      }

      await jobQueue.send(JobQueues.BOUNDARY_EXTRACT, {
        messageId: eventPayload.messageId,
        streamId,
        workspaceId,
      })

      logger.debug({ streamId, messageId: eventPayload.messageId }, "Boundary extraction job dispatched")
    },
  })
}
