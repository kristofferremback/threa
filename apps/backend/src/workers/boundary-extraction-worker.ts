import type { BoundaryExtractionJobData, JobHandler } from "../lib/job-queue"
import type { BoundaryExtractionService } from "../services/boundary-extraction-service"
import { logger } from "../lib/logger"

export interface BoundaryExtractionWorkerDeps {
  service: BoundaryExtractionService
}

/**
 * Create the boundary extraction job handler for queue system.
 * Thin wrapper that delegates to the service.
 */
export function createBoundaryExtractionWorker(
  deps: BoundaryExtractionWorkerDeps
): JobHandler<BoundaryExtractionJobData> {
  const { service } = deps

  return async (job) => {
    const { messageId, streamId, workspaceId } = job.data

    logger.info({ jobId: job.id, messageId, streamId }, "Processing boundary extraction job")

    const conversation = await service.processMessage(messageId, streamId, workspaceId)

    if (conversation) {
      logger.info({ jobId: job.id, conversationId: conversation.id, messageId }, "Boundary extraction job completed")
    } else {
      logger.warn({ jobId: job.id, messageId }, "Boundary extraction produced no conversation")
    }
  }
}
