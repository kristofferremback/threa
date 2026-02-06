/**
 * Shared attachment processing lifecycle.
 *
 * Encapsulates Phase 1 (claim) and Phase 3 (save/skip) of the three-phase
 * pattern (INV-41). The caller supplies only the Phase 2 processing logic
 * via the callback.
 *
 * Used by text, word, and excel services. PDF is excluded — its fan-out/fan-in
 * pipeline is structurally different.
 */

import type { Pool } from "pg"
import { withClient, withTransaction } from "../db"
import { extractionId } from "./id"
import { AttachmentRepository, AttachmentExtractionRepository } from "../repositories"
import type { Attachment } from "../repositories/attachment-repository"
import type { InsertAttachmentExtractionParams } from "../repositories/attachment-extraction-repository"
import { ProcessingStatuses } from "@threa/types"
import { logger } from "./logger"

export type ExtractionData = Omit<InsertAttachmentExtractionParams, "id" | "attachmentId" | "workspaceId">

/**
 * Process an attachment through the three-phase lifecycle:
 *
 * 1. **Claim** — find attachment, atomically transition to PROCESSING
 * 2. **Process** — call `callback(attachment)` with no DB connection held
 * 3. **Save** — insert extraction record + mark COMPLETED, or mark SKIPPED if callback returns null
 *
 * Errors from the callback propagate to the caller (job queue handles retries).
 */
export async function processAttachment(
  pool: Pool,
  attachmentId: string,
  callback: (attachment: Attachment) => Promise<ExtractionData | null>
): Promise<void> {
  const log = logger.child({ attachmentId })

  // Phase 1: Fetch attachment and claim it for processing
  const attachment = await withClient(pool, async (client) => {
    const att = await AttachmentRepository.findById(client, attachmentId)
    if (!att) {
      log.warn("Attachment not found, skipping")
      return null
    }

    const claimed = await AttachmentRepository.updateProcessingStatus(
      client,
      attachmentId,
      ProcessingStatuses.PROCESSING,
      { onlyIfStatusIn: [ProcessingStatuses.PENDING, ProcessingStatuses.PROCESSING, ProcessingStatuses.FAILED] }
    )

    if (!claimed) {
      log.info({ currentStatus: att.processingStatus }, "Attachment already completed/skipped, skipping")
      return null
    }

    return att
  })

  if (!attachment) {
    return
  }

  // Phase 2: Process (no DB connection held)
  const extractionData = await callback(attachment)

  // Phase 3: Save extraction or mark skipped
  if (extractionData === null) {
    await AttachmentRepository.updateProcessingStatus(pool, attachmentId, ProcessingStatuses.SKIPPED)
    return
  }

  await withTransaction(pool, async (client) => {
    await AttachmentExtractionRepository.insert(client, {
      id: extractionId(),
      attachmentId,
      workspaceId: attachment.workspaceId,
      ...extractionData,
    })

    await AttachmentRepository.updateProcessingStatus(client, attachmentId, ProcessingStatuses.COMPLETED)
  })

  log.info("Attachment extraction saved successfully")
}
