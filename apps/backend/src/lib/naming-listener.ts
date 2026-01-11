import type { PoolClient } from "pg"
import type { DatabasePools } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import { StreamRepository } from "../repositories/stream-repository"
import type { OutboxEvent } from "../repositories/outbox-repository"
import { parseMessageCreatedPayloadWithClient } from "./outbox-payload-parsers"
import { needsAutoNaming } from "./display-name"
import { logger } from "./logger"
import { AuthorTypes } from "@threa/types"
import { job, type HandlerEffect } from "./handler-effects"

/**
 * Creates a naming listener that dispatches auto-naming jobs for messages
 * in streams that need display name generation.
 *
 * Uses pure handler mode for guaranteed at-least-once delivery of pg-boss jobs.
 *
 * Flow:
 * 1. Message arrives (via outbox)
 * 2. Check if stream needs auto-naming (scratchpad/thread without generated name)
 * 3. Return pg-boss job effect for LLM processing
 */
export function createNamingListener(
  pools: DatabasePools,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "pureHandler" | "jobQueue" | "listenPool" | "queryPool">
): OutboxListener {
  return new OutboxListener({
    ...config,
    listenPool: pools.listen,
    queryPool: pools.main,
    listenerId: "naming",
    jobQueue,
    pureHandler: async (outboxEvent: OutboxEvent, client: PoolClient): Promise<HandlerEffect[]> => {
      if (outboxEvent.eventType !== "message:created") {
        return []
      }

      const payload = await parseMessageCreatedPayloadWithClient(outboxEvent.payload, client)
      if (!payload) {
        logger.debug({ eventId: outboxEvent.id }, "Naming listener: malformed event, skipping")
        return []
      }

      const { streamId, event } = payload
      const isAgentMessage = event.actorType !== AuthorTypes.USER

      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        logger.warn({ streamId }, "Naming listener: stream not found")
        return []
      }

      if (!needsAutoNaming(stream)) {
        return []
      }

      logger.info({ streamId, requireName: isAgentMessage }, "Naming job will be dispatched")

      // Return job effect - will be executed atomically with cursor update
      return [
        job(JobQueues.NAMING_GENERATE, {
          streamId,
          requireName: isAgentMessage,
        }),
      ]
    },
  })
}
