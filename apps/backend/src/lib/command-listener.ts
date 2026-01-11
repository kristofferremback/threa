import type { PoolClient } from "pg"
import type { DatabasePools } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import type { OutboxEvent, CommandDispatchedOutboxPayload } from "../repositories/outbox-repository"
import { logger } from "./logger"
import { job, type HandlerEffect } from "./handler-effects"

interface CommandDispatchedEventPayload {
  commandId: string
  name: string
  args: string
  status: string
}

/**
 * Creates a command listener that dispatches command execution jobs
 * when `command:dispatched` events appear in the outbox.
 *
 * Uses pure handler mode for guaranteed at-least-once delivery of pg-boss jobs.
 * This ensures durability: the job is only dispatched after the
 * command_dispatched event is committed to the database.
 */
export function createCommandListener(
  pools: DatabasePools,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "pureHandler" | "jobQueue" | "listenPool" | "queryPool">
): OutboxListener {
  return new OutboxListener({
    ...config,
    listenPool: pools.listen,
    queryPool: pools.main,
    listenerId: "command",
    jobQueue,
    pureHandler: async (outboxEvent: OutboxEvent, _client: PoolClient): Promise<HandlerEffect[]> => {
      if (outboxEvent.eventType !== "command:dispatched") {
        return []
      }

      const payload = outboxEvent.payload as CommandDispatchedOutboxPayload
      const { event, workspaceId, streamId, authorId } = payload
      const eventPayload = event.payload as CommandDispatchedEventPayload

      logger.info(
        { commandId: eventPayload.commandId, commandName: eventPayload.name, streamId },
        "Command job will be dispatched"
      )

      // Return job effect - will be executed atomically with cursor update
      return [
        job(JobQueues.COMMAND_EXECUTE, {
          commandId: eventPayload.commandId,
          commandName: eventPayload.name,
          args: eventPayload.args,
          workspaceId,
          streamId,
          userId: authorId,
        }),
      ]
    },
  })
}
