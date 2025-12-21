import { Pool } from "pg"
import * as fs from "fs/promises"
import { withTransaction, withClient } from "../db"
import { AttachmentRepository, Attachment, OutboxRepository } from "../repositories"
import { attachmentId } from "../lib/id"
import type { StorageProvider } from "../lib/storage/s3-client"

export interface UploadParams {
  workspaceId: string
  streamId: string
  filename: string
  mimeType: string
  filePath: string
  sizeBytes: number
}

export class AttachmentService {
  constructor(
    private pool: Pool,
    private storage: StorageProvider
  ) {}

  async upload(params: UploadParams): Promise<Attachment> {
    const id = attachmentId()
    const storagePath = `${params.workspaceId}/${params.streamId}/${id}/${params.filename}`

    try {
      // 1. Stream upload to S3 from temp file
      await this.storage.uploadFromPath(storagePath, params.filePath, params.mimeType)

      // 2. Insert metadata and emit outbox event in transaction
      const attachment = await withTransaction(this.pool, async (client) => {
        const attachment = await AttachmentRepository.insert(client, {
          id,
          workspaceId: params.workspaceId,
          streamId: params.streamId,
          filename: params.filename,
          mimeType: params.mimeType,
          sizeBytes: params.sizeBytes,
          storagePath,
        })

        // Emit outbox event for future workers (text extraction, embeddings, etc.)
        await OutboxRepository.insert(client, "attachment:uploaded", {
          workspaceId: params.workspaceId,
          streamId: params.streamId,
          attachmentId: id,
          filename: params.filename,
          mimeType: params.mimeType,
          sizeBytes: params.sizeBytes,
          storagePath,
        })

        return attachment
      })

      return attachment
    } finally {
      // 3. Always clean up temp file
      await fs.unlink(params.filePath).catch(() => {
        // Ignore errors - file may already be deleted
      })
    }
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
