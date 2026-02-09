import type { WordProcessJobData, JobHandler } from "../../../lib/job-queue"
import type { WordProcessingServiceLike } from "./types"
import { logger } from "../../../lib/logger"

export interface WordProcessingWorkerDeps {
  wordProcessingService: WordProcessingServiceLike
}

/**
 * Create the Word processing job handler for the queue system.
 *
 * This is a thin wrapper that extracts job data and delegates to the service.
 * All business logic lives in the service for reusability and testability.
 */
export function createWordProcessingWorker(deps: WordProcessingWorkerDeps): JobHandler<WordProcessJobData> {
  const { wordProcessingService } = deps

  return async (job) => {
    const { attachmentId, filename } = job.data

    logger.info({ jobId: job.id, attachmentId, filename }, "Processing Word document job")

    await wordProcessingService.processWord(attachmentId)

    logger.info({ jobId: job.id, attachmentId }, "Word processing job completed")
  }
}
