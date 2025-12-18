import type { NamingJobData, JobHandler } from "../lib/job-queue"
import { logger } from "../lib/logger"

/** Interface for any service that can handle naming jobs */
export interface StreamNamingServiceLike {
  attemptAutoNaming(streamId: string): Promise<boolean>
}

export interface NamingWorkerDeps {
  streamNamingService: StreamNamingServiceLike
}

/**
 * Create the naming job handler for pg-boss.
 *
 * This is a thin wrapper that extracts job data and delegates to the naming service.
 * All business logic lives in the service for reusability and testability.
 */
export function createNamingWorker(deps: NamingWorkerDeps): JobHandler<NamingJobData> {
  const { streamNamingService } = deps

  return async (job) => {
    const { streamId } = job.data

    logger.info({ jobId: job.id, streamId }, "Processing naming job")

    const named = await streamNamingService.attemptAutoNaming(streamId)

    logger.info({ jobId: job.id, streamId, named }, "Naming job completed")
  }
}
