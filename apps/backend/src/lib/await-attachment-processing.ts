import type { Pool } from "pg"
import { ProcessingStatuses } from "@threa/types"
import { AttachmentRepository } from "../repositories/attachment-repository"
import { logger } from "./logger"

/**
 * Default timeout for awaiting attachment processing (60 seconds).
 * Works for both images and PDFs.
 */
export const DEFAULT_ATTACHMENT_PROCESSING_TIMEOUT_MS = 60_000

/**
 * Polling interval for checking processing status (1 second).
 */
const POLL_INTERVAL_MS = 1_000

/**
 * Result of awaiting attachment processing.
 */
export interface AwaitAttachmentProcessingResult {
  /** Whether all attachments completed processing */
  allCompleted: boolean
  /** IDs of attachments that completed successfully */
  completedIds: string[]
  /** IDs of attachments that failed or timed out */
  failedOrTimedOutIds: string[]
}

/**
 * Await processing completion for a list of attachment IDs.
 *
 * Polls the database until all attachments reach a terminal state (completed, failed, skipped)
 * or the timeout is reached. Works for all attachment types (images, PDFs, etc.).
 *
 * @param pool - Database pool
 * @param attachmentIds - IDs of attachments to wait for
 * @param timeoutMs - Maximum time to wait (default: 60s)
 * @returns Result indicating which attachments completed
 */
export async function awaitAttachmentProcessing(
  pool: Pool,
  attachmentIds: string[],
  timeoutMs: number = DEFAULT_ATTACHMENT_PROCESSING_TIMEOUT_MS
): Promise<AwaitAttachmentProcessingResult> {
  if (attachmentIds.length === 0) {
    return { allCompleted: true, completedIds: [], failedOrTimedOutIds: [] }
  }

  const startTime = Date.now()
  const pendingIds = new Set(attachmentIds)
  const completedIds: string[] = []
  const failedIds: string[] = []

  logger.debug({ attachmentIds, timeoutMs }, "Starting to await attachment processing")

  // Each iteration auto-acquires and releases a connection via pool (not withClient).
  // This is intentional per INV-41: we release between polling intervals to avoid
  // holding connections during sleep. Do NOT wrap in withClient.
  while (pendingIds.size > 0 && Date.now() - startTime < timeoutMs) {
    const attachments = await AttachmentRepository.findByIds(pool, Array.from(pendingIds))

    for (const attachment of attachments) {
      if (attachment.processingStatus === ProcessingStatuses.COMPLETED) {
        pendingIds.delete(attachment.id)
        completedIds.push(attachment.id)
      } else if (
        attachment.processingStatus === ProcessingStatuses.FAILED ||
        attachment.processingStatus === ProcessingStatuses.SKIPPED
      ) {
        pendingIds.delete(attachment.id)
        failedIds.push(attachment.id)
      }
      // PENDING and PROCESSING continue to be polled
    }

    // If all are done, return early
    if (pendingIds.size === 0) {
      break
    }

    // Wait before polling again
    await sleep(POLL_INTERVAL_MS)
  }

  // Any remaining pending IDs are timed out
  const timedOutIds = Array.from(pendingIds)
  const failedOrTimedOutIds = [...failedIds, ...timedOutIds]

  const result: AwaitAttachmentProcessingResult = {
    allCompleted: failedOrTimedOutIds.length === 0,
    completedIds,
    failedOrTimedOutIds,
  }

  if (timedOutIds.length > 0) {
    logger.warn(
      { timedOutIds, elapsedMs: Date.now() - startTime, timeoutMs },
      "Some attachments timed out waiting for processing"
    )
  }

  logger.debug(
    {
      allCompleted: result.allCompleted,
      completedCount: completedIds.length,
      failedCount: failedIds.length,
      timedOutCount: timedOutIds.length,
      elapsedMs: Date.now() - startTime,
    },
    "Finished awaiting attachment processing"
  )

  return result
}

/**
 * Check if any attachments in a list are still pending or processing.
 * Quick check without polling.
 */
export async function hasPendingAttachmentProcessing(pool: Pool, attachmentIds: string[]): Promise<boolean> {
  if (attachmentIds.length === 0) return false

  const attachments = await AttachmentRepository.findByIds(pool, attachmentIds)

  return attachments.some(
    (a) => a.processingStatus === ProcessingStatuses.PENDING || a.processingStatus === ProcessingStatuses.PROCESSING
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
