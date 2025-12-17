import type { Pool } from "pg"
import { withClient } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import { StreamRepository } from "../repositories/stream-repository"
import type { OutboxEvent, MessageCreatedOutboxPayload } from "../repositories/outbox-repository"
import { AuthorTypes, CompanionModes } from "./constants"
import { logger } from "./logger"

/**
 * Creates a companion listener that dispatches agentic jobs for messages
 * in streams with companion mode enabled.
 *
 * Flow:
 * 1. Message arrives (via outbox)
 * 2. Check if it's a user message (not persona response)
 * 3. Check if stream has companion mode = 'on'
 * 4. Dispatch durable job to pg-boss for agent processing
 */
export function createCompanionListener(
  pool: Pool,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler">,
): OutboxListener {
  return new OutboxListener(pool, {
    ...config,
    listenerId: "companion",
    handler: async (event: OutboxEvent) => {
      // Only process message:created events
      if (event.eventType !== "message:created") {
        return
      }

      const payload = event.payload as MessageCreatedOutboxPayload
      const { message, streamId } = payload

      // Ignore persona messages (avoid infinite loops)
      if (message.authorType !== AuthorTypes.USER) {
        return
      }

      // Look up stream to check companion mode
      await withClient(pool, async (client) => {
        const stream = await StreamRepository.findById(client, streamId)
        if (!stream) {
          logger.warn({ streamId }, "Companion listener: stream not found")
          return
        }

        if (stream.companionMode !== CompanionModes.ON) {
          return
        }

        // Dispatch job to pg-boss for durable processing
        await jobQueue.send(JobQueues.COMPANION_RESPOND, {
          streamId,
          messageId: message.id,
          triggeredBy: message.authorId,
        })

        logger.info(
          { streamId, messageId: message.id },
          "Companion job dispatched",
        )
      })
    },
  })
}
