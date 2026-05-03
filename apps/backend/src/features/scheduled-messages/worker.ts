import type { JobHandler, ScheduledMessageSendJobData } from "../../lib/queue"
import { logger } from "../../lib/logger"
import { ScheduledMessagesService } from "./service"

/**
 * Worker handler for `scheduled_message.send`. Delegates to the service's
 * idempotent `fire`; the worker holds no DB connection between calls (INV-41).
 *
 * If the service signals lock contention (`reschedule = true`), we throw a
 * recoverable error so the queue's retry/backoff machinery requeues the job.
 * Bounded retry budget is enforced inside `service.fire()`, which transitions
 * the row to `failed` once exceeded.
 */
export function createScheduledMessageSendWorker(deps: {
  scheduledMessagesService: ScheduledMessagesService
}): JobHandler<ScheduledMessageSendJobData> {
  return async (job) => {
    const { workspaceId, scheduledMessageId, userId } = job.data
    const result = await deps.scheduledMessagesService.fire({
      workspaceId,
      scheduledMessageId,
    })

    if (result.fired) {
      logger.info({ jobId: job.id, scheduledMessageId, workspaceId, userId }, "scheduled_message fired")
      return
    }

    if (result.reschedule) {
      // Throwing causes the queue manager to apply its retry backoff. By the
      // next attempt the editor lock has likely cleared (60s editor TTL vs.
      // ~5s worker retry); if not, the bounded retry counter inside
      // `service.fire()` will trip and the row is marked failed.
      throw new Error("scheduled_message lock contended; will retry")
    }

    logger.debug(
      { jobId: job.id, scheduledMessageId, workspaceId, userId },
      "scheduled_message fire skipped (already sent, cancelled, or marked failed)"
    )
  }
}

export { ScheduledMessagesService }
