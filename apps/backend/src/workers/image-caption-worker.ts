import type { ImageCaptionJobData, JobHandler } from "../lib/job-queue"
import type { ImageCaptionServiceLike } from "../services/image-caption"
import { logger } from "../lib/logger"

export interface ImageCaptionWorkerDeps {
  imageCaptionService: ImageCaptionServiceLike
}

/**
 * Create the image caption job handler for the queue system.
 *
 * This is a thin wrapper that extracts job data and delegates to the service.
 * All business logic lives in the service for reusability and testability.
 */
export function createImageCaptionWorker(deps: ImageCaptionWorkerDeps): JobHandler<ImageCaptionJobData> {
  const { imageCaptionService } = deps

  return async (job) => {
    const { attachmentId, filename, mimeType } = job.data

    logger.info({ jobId: job.id, attachmentId, filename, mimeType }, "Processing image caption job")

    await imageCaptionService.processImage(attachmentId)

    logger.info({ jobId: job.id, attachmentId }, "Image caption job completed")
  }
}
