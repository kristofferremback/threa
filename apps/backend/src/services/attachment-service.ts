import { Pool } from "pg"
import { withTransaction, withClient } from "../db"
import { AttachmentRepository, Attachment, OutboxRepository } from "../repositories"
import type { StorageProvider } from "../lib/storage/s3-client"

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
    private storage: StorageProvider
  ) {}

  /**
   * Records attachment metadata after file has been uploaded to S3.
   * The upload itself is handled by multer-s3 middleware (streaming, no temp files).
   * File is uploaded to workspace-level; streamId is set when attached to a message.
   */
  async create(params: CreateAttachmentParams): Promise<Attachment> {
    return withTransaction(this.pool, async (client) => {
      const attachment = await AttachmentRepository.insert(client, {
        id: params.id,
        workspaceId: params.workspaceId,
        uploadedBy: params.uploadedBy,
        filename: params.filename,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        storagePath: params.storagePath,
      })

      // Emit outbox event for future workers (text extraction, embeddings, etc.)
      await OutboxRepository.insert(client, "attachment:uploaded", {
        workspaceId: params.workspaceId,
        attachmentId: params.id,
        filename: params.filename,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        storagePath: params.storagePath,
      })

      return attachment
    })
  }

  async getById(id: string): Promise<Attachment | null> {
    return withClient(this.pool, (client) => AttachmentRepository.findById(client, id))
  }

  async getByIds(ids: string[]): Promise<Attachment[]> {
    return withClient(this.pool, (client) => AttachmentRepository.findByIds(client, ids))
  }

  async getByMessageId(messageId: string): Promise<Attachment[]> {
    return withClient(this.pool, (client) => AttachmentRepository.findByMessageId(client, messageId))
  }

  async getByMessageIds(messageIds: string[]): Promise<Map<string, Attachment[]>> {
    return withClient(this.pool, (client) => AttachmentRepository.findByMessageIds(client, messageIds))
  }

  async getDownloadUrl(attachment: Attachment): Promise<string> {
    return this.storage.getSignedDownloadUrl(attachment.storagePath)
  }

  async delete(id: string): Promise<boolean> {
    const attachment = await this.getById(id)
    if (!attachment) return false

    // Delete from S3
    await this.storage.delete(attachment.storagePath)

    // Delete from database
    return withTransaction(this.pool, (client) => AttachmentRepository.delete(client, id))
  }
}
