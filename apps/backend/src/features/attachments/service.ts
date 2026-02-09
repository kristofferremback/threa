import { Pool } from "pg"
import { withTransaction } from "../../db"
import { OutboxRepository } from "../../lib/outbox"
import { AttachmentRepository, type Attachment } from "./repository"
import { AttachmentExtractionRepository } from "./extraction-repository"
import type { StorageProvider } from "../../lib/storage/s3-client"
import { AttachmentSafetyStatuses, ProcessingStatuses } from "@threa/types"
import { isAttachmentSafeForSharing, safetyStatusBlockReason, type MalwareScanner } from "./upload-safety-policy"
import { logger } from "../../lib/logger"

export interface CreateAttachmentParams {
  id: string
  workspaceId: string
  uploadedBy: string
  filename: string
  mimeType: string
  sizeBytes: number
  storagePath: string
}

export type CreateAttachmentForUploadResult =
  | { status: "created"; attachment: Attachment }
  | { status: "blocked"; reason: string }
  | { status: "cleanup_failed"; attachmentId: string }

export class AttachmentService {
  constructor(
    private pool: Pool,
    private storage: StorageProvider,
    private malwareScanner: MalwareScanner
  ) {}

  /**
   * Records attachment metadata after file has been uploaded to S3.
   * The upload itself is handled by multer-s3 middleware (streaming, no temp files).
   * File is uploaded to workspace-level; streamId is set when attached to a message.
   * Malware scan runs before attachment processing workers are dispatched.
   */
  async create(params: CreateAttachmentParams): Promise<Attachment> {
    const attachment = await withTransaction(this.pool, async (client) => {
      return AttachmentRepository.insert(client, {
        id: params.id,
        workspaceId: params.workspaceId,
        uploadedBy: params.uploadedBy,
        filename: params.filename,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        storagePath: params.storagePath,
        safetyStatus: AttachmentSafetyStatuses.PENDING_SCAN,
      })
    })

    const scanResult = await this.malwareScanner.scan({
      storagePath: params.storagePath,
      filename: params.filename,
      mimeType: params.mimeType,
    })

    return withTransaction(this.pool, async (client) => {
      const safetyUpdated = await AttachmentRepository.updateSafetyStatus(client, params.id, scanResult.status, {
        onlyIfStatus: AttachmentSafetyStatuses.PENDING_SCAN,
      })
      if (!safetyUpdated) {
        const current = await AttachmentRepository.findById(client, params.id)
        if (!current) {
          throw new Error(`Attachment ${params.id} was deleted before safety status could be updated`)
        }
        throw new Error(
          `Attachment ${params.id} safety status transition rejected from ${current.safetyStatus} to ${scanResult.status}`
        )
      }

      if (scanResult.status === AttachmentSafetyStatuses.CLEAN) {
        // Emit outbox event for workers only after malware scan is clean.
        await OutboxRepository.insert(client, "attachment:uploaded", {
          workspaceId: params.workspaceId,
          attachmentId: params.id,
          filename: params.filename,
          mimeType: params.mimeType,
          sizeBytes: params.sizeBytes,
          storagePath: params.storagePath,
        })
      } else {
        await AttachmentRepository.updateProcessingStatus(client, params.id, ProcessingStatuses.SKIPPED)
        logger.warn(
          {
            attachmentId: params.id,
            filename: params.filename,
            mimeType: params.mimeType,
            reason: scanResult.reason ?? "unknown",
          },
          "Attachment quarantined by malware scanner"
        )
      }

      const updated = await AttachmentRepository.findById(client, attachment.id)
      if (!updated) {
        throw new Error(`Attachment not found after safety update: ${attachment.id}`)
      }
      return updated
    })
  }

  /**
   * Creates an attachment for upload response flows.
   * Unsafe attachments are cleaned up immediately and return a blocked result.
   */
  async createForUpload(params: CreateAttachmentParams): Promise<CreateAttachmentForUploadResult> {
    const attachment = await this.create(params)
    const blockReason = this.getSharingBlockReason(attachment)

    if (!blockReason) {
      return { status: "created", attachment }
    }

    try {
      const deleted = await this.delete(attachment.id)
      if (!deleted) {
        logger.error({ attachmentId: attachment.id }, "Quarantined attachment cleanup did not delete attachment")
        return { status: "cleanup_failed", attachmentId: attachment.id }
      }
    } catch (err) {
      logger.error({ err, attachmentId: attachment.id }, "Failed to clean up quarantined upload")
      return { status: "cleanup_failed", attachmentId: attachment.id }
    }

    return { status: "blocked", reason: blockReason }
  }

  getSharingBlockReason(attachment: Attachment): string | null {
    if (isAttachmentSafeForSharing(attachment.safetyStatus)) {
      return null
    }
    return safetyStatusBlockReason(attachment.safetyStatus)
  }

  async getById(id: string): Promise<Attachment | null> {
    return AttachmentRepository.findById(this.pool, id)
  }

  async getByIds(ids: string[]): Promise<Attachment[]> {
    return AttachmentRepository.findByIds(this.pool, ids)
  }

  async getByMessageId(messageId: string): Promise<Attachment[]> {
    return AttachmentRepository.findByMessageId(this.pool, messageId)
  }

  async getByMessageIds(messageIds: string[]): Promise<Map<string, Attachment[]>> {
    return AttachmentRepository.findByMessageIds(this.pool, messageIds)
  }

  async getDownloadUrl(attachment: Attachment): Promise<string> {
    return this.storage.getSignedDownloadUrl(attachment.storagePath)
  }

  async delete(id: string): Promise<boolean> {
    const attachment = await this.getById(id)
    if (!attachment) return false

    // Delete from S3
    await this.storage.delete(attachment.storagePath)

    // Delete from database (attachment + extraction)
    return withTransaction(this.pool, async (client) => {
      await AttachmentExtractionRepository.deleteByAttachmentId(client, id)
      return AttachmentRepository.delete(client, id)
    })
  }
}
