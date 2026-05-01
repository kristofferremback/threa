import type { JobHandler, ScheduledMessageFireJobData } from "../../lib/queue"
import { logger } from "../../lib/logger"
import type { ScheduledMessagesService } from "./service"

export function createScheduledMessageFireWorker(deps: {
  scheduledMessagesService: ScheduledMessagesService
}): JobHandler<ScheduledMessageFireJobData> {
  return async (job) => {
    const { scheduledMessageId, workspaceId, authorId } = job.data

    const result = await deps.scheduledMessagesService.fire({ scheduledId: scheduledMessageId })

    if (result.fired) {
      logger.info({ jobId: job.id, scheduledMessageId, workspaceId, authorId }, "Scheduled message fired")
    } else {
      logger.debug(
        { jobId: job.id, scheduledMessageId, workspaceId, authorId },
        "Scheduled message skipped (already sent, cancelled, or paused)"
      )
    }
  }
}
