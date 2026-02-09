import { Pool } from "pg"
import { withTransaction } from "../../db"
import { OutboxRepository } from "../../lib/outbox"
import { AttachmentRepository, type Attachment } from "./repository"
import { AttachmentExtractionRepository } from "./extraction-repository"
import type { StorageProvider } from "../../lib/storage/s3-client"
import { AttachmentSafetyStatuses, ProcessingStatuses } from "@threa/types"
import type { MalwareScanner } from "./upload-safety-policy"
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
      const safetyUpdated = await AttachmentRepository.updateSafetyStatus(client, params.id, scanResult.status)
      if (!safetyUpdated) {
        throw new Error(`Failed to update safety status for attachment ${params.id}`)
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
