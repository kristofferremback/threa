import type { Pool } from "pg"
import { withClient } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import { StreamRepository } from "../repositories/stream-repository"
import type { OutboxEvent } from "../repositories/outbox-repository"
import { parseMessageCreatedPayload } from "./outbox-payload-parsers"
import { needsAutoNaming } from "./display-name"
import { logger } from "./logger"
import { AuthorTypes } from "@threa/types"

/**
 * Creates a naming listener that dispatches auto-naming jobs for messages
 * in streams that need display name generation.
 *
 * Flow:
 * 1. Message arrives (via outbox)
 * 2. Check if stream needs auto-naming (scratchpad/thread without generated name)
 * 3. Dispatch durable job to pg-boss for LLM processing
 */
export function createNamingListener(
  pool: Pool,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler">
): OutboxListener {
  return new OutboxListener(pool, {
    ...config,
    listenerId: "naming",
    handler: async (outboxEvent: OutboxEvent) => {
      if (outboxEvent.eventType !== "message:created") {
        return
      }

      const payload = await parseMessageCreatedPayload(outboxEvent.payload, pool)
      if (!payload) {
        logger.debug({ eventId: outboxEvent.id }, "Naming listener: malformed event, skipping")
        return
      }

      const { streamId, event } = payload
      const isAgentMessage = event.actorType !== AuthorTypes.USER

      await withClient(pool, async (client) => {
        const stream = await StreamRepository.findById(client, streamId)
        if (!stream) {
          logger.warn({ streamId }, "Naming listener: stream not found")
          return
        }

        if (!needsAutoNaming(stream)) {
          return
        }

        await jobQueue.send(JobQueues.NAMING_GENERATE, {
          streamId,
          requireName: isAgentMessage,
        })

        logger.info({ streamId, requireName: isAgentMessage }, "Naming job dispatched")
      })
    },
  })
}
