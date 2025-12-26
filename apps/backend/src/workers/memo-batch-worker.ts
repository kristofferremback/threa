import type { Pool } from "pg"
import { withClient } from "../db"
import {
  JobQueues,
  type JobHandler,
  type JobQueueManager,
  type MemoBatchCheckJobData,
  type MemoBatchProcessJobData,
} from "../lib/job-queue"
import { StreamStateRepository } from "../repositories"
import type { MemoService } from "../services/memo-service"
import { logger } from "../lib/logger"

const BATCH_CAP_INTERVAL_SECONDS = 300 // 5 minutes
const BATCH_QUIET_INTERVAL_SECONDS = 30 // 30 seconds

export interface MemoBatchWorkerDeps {
  pool: Pool
  memoService: MemoService
  jobQueue: JobQueueManager
}

/**
 * Create the memo batch check job handler.
 *
 * This runs on a schedule (every 30s) and checks which streams have
 * pending items ready to process based on debounce logic:
 * - Cap: process at most every 5 minutes per stream
 * - Quick: process after 30s quiet per stream
 *
 * For each stream ready, it dispatches a batch process job.
 */
export function createMemoBatchCheckWorker(deps: MemoBatchWorkerDeps): JobHandler<MemoBatchCheckJobData> {
  const { pool, jobQueue } = deps

  return async (job) => {
    logger.debug({ jobId: job.id }, "Checking for streams ready for memo processing")

    const streamsToProcess = await withClient(pool, async (client) => {
      return StreamStateRepository.findStreamsReadyToProcess(client, {
        capIntervalSeconds: BATCH_CAP_INTERVAL_SECONDS,
        quietIntervalSeconds: BATCH_QUIET_INTERVAL_SECONDS,
      })
    })

    if (streamsToProcess.length === 0) {
      logger.debug({ jobId: job.id }, "No streams ready for memo processing")
      return
    }

    logger.info({ jobId: job.id, streamCount: streamsToProcess.length }, "Dispatching memo batch process jobs")

    for (const { workspaceId, streamId } of streamsToProcess) {
      await jobQueue.send(JobQueues.MEMO_BATCH_PROCESS, { workspaceId, streamId })
    }
  }
}

/**
 * Create the memo batch process job handler.
 *
 * This processes all pending items for a specific stream.
 */
export function createMemoBatchProcessWorker(deps: MemoBatchWorkerDeps): JobHandler<MemoBatchProcessJobData> {
  const { memoService } = deps

  return async (job) => {
    const { workspaceId, streamId } = job.data

    logger.info({ jobId: job.id, workspaceId, streamId }, "Processing memo batch")

    const result = await memoService.processBatch(workspaceId, streamId)

    logger.info(
      {
        jobId: job.id,
        workspaceId,
        streamId,
        processed: result.processed,
        memosCreated: result.memosCreated,
        memosRevised: result.memosRevised,
      },
      "Memo batch processing completed"
    )
  }
}

/**
 * Schedule the memo batch check job to run periodically.
 * Uses pg-boss's schedule feature for reliable cron-like execution.
 */
export async function scheduleMemoBatchCheck(jobQueue: JobQueueManager): Promise<void> {
  const boss = jobQueue.getBoss()

  await boss.schedule(
    JobQueues.MEMO_BATCH_CHECK,
    "*/30 * * * * *",
    {},
    {
      tz: "UTC",
    }
  )

  logger.info("Memo batch check scheduled (every 30 seconds)")
}
