import type { NamingJobData, JobHandler } from "../../lib/queue"
import { logger } from "../../lib/logger"

/** Interface for any service that can handle naming jobs */
export interface StreamNamingServiceLike {
  attemptAutoNaming(streamId: string, requireName: boolean): Promise<boolean>
}

export interface NamingWorkerDeps {
  streamNamingService: StreamNamingServiceLike
}

/**
 * Create the naming job handler for queue system.
 *
 * This is a thin wrapper that extracts job data and delegates to the naming service.
 * All business logic lives in the service for reusability and testability.
 */
export function createNamingWorker(deps: NamingWorkerDeps): JobHandler<NamingJobData> {
  const { streamNamingService } = deps

  return async (job) => {
    const { streamId, requireName } = job.data

    logger.info({ jobId: job.id, streamId, requireName }, "Processing naming job")

    const named = await streamNamingService.attemptAutoNaming(streamId, requireName)

    logger.info({ jobId: job.id, streamId, requireName, named }, "Naming job completed")
  }
}
