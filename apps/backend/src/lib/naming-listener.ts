import { withClient, type DatabasePools } from "../db"
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
  pools: DatabasePools,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler" | "listenPool" | "queryPool">
): OutboxListener {
  return new OutboxListener({
    ...config,
    listenPool: pools.listen,
    queryPool: pools.main,
    listenerId: "naming",
    handler: async (outboxEvent: OutboxEvent) => {
      if (outboxEvent.eventType !== "message:created") {
        return
      }

      const payload = await parseMessageCreatedPayload(outboxEvent.payload, pools.main)
      if (!payload) {
        logger.debug({ eventId: outboxEvent.id }, "Naming listener: malformed event, skipping")
        return
      }

      const { streamId, event } = payload
      const isAgentMessage = event.actorType !== AuthorTypes.USER

      await withClient(pools.main, async (client) => {
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
