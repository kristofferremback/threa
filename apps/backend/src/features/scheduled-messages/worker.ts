import type { JobHandler, ScheduledMessageFireJobData } from "../../lib/queue"
import { logger } from "../../lib/logger"
import type { ScheduledMessagesService } from "./service"

export function createScheduledMessageWorker(deps: {
  scheduledMessagesService: ScheduledMessagesService
}): JobHandler<ScheduledMessageFireJobData> {
  return async (job) => {
    const { scheduledMessageId, workspaceId } = job.data
    const result = await deps.scheduledMessagesService.fireDue({ scheduledId: scheduledMessageId })
    if (result.fired) {
      logger.info({ jobId: job.id, scheduledMessageId, workspaceId }, "Scheduled message fired")
    } else {
      logger.debug({ jobId: job.id, scheduledMessageId, workspaceId }, "Scheduled message skipped")
    }
  }
}
