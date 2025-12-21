import { PoolClient } from "pg"
import { sql } from "../db"

// Internal row type (snake_case, not exported)
interface AttachmentRow {
  id: string
  workspace_id: string
  stream_id: string
  message_id: string | null
  filename: string
  mime_type: string
  size_bytes: string
  storage_provider: string
  storage_path: string
  processing_status: string
  created_at: Date
}

// Domain type (camelCase, exported)
export interface Attachment {
  id: string
  workspaceId: string
  streamId: string
  messageId: string | null
  filename: string
  mimeType: string
  sizeBytes: number
  storageProvider: "s3" | "local"
  storagePath: string
  processingStatus: "pending" | "processing" | "completed" | "failed"
  createdAt: Date
}

export interface InsertAttachmentParams {
  id: string
  workspaceId: string
  streamId: string
  filename: string
  mimeType: string
  sizeBytes: number
  storagePath: string
  storageProvider?: "s3" | "local"
}

function mapRowToAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    streamId: row.stream_id,
    messageId: row.message_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    storageProvider: row.storage_provider as "s3" | "local",
    storagePath: row.storage_path,
    processingStatus: row.processing_status as Attachment["processingStatus"],
    createdAt: row.created_at,
  }
}

const SELECT_FIELDS = `
  id, workspace_id, stream_id, message_id,
  filename, mime_type, size_bytes,
  storage_provider, storage_path, processing_status,
  created_at
`

export const AttachmentRepository = {
  async findById(client: PoolClient, id: string): Promise<Attachment | null> {
    const result = await client.query<AttachmentRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM attachments WHERE id = ${id}`
    )
    return result.rows[0] ? mapRowToAttachment(result.rows[0]) : null
  },

  async findByIds(client: PoolClient, ids: string[]): Promise<Attachment[]> {
    if (ids.length === 0) return []
    const result = await client.query<AttachmentRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM attachments WHERE id = ANY(${ids})`
    )
    return result.rows.map(mapRowToAttachment)
  },

  async findByMessageId(client: PoolClient, messageId: string): Promise<Attachment[]> {
    const result = await client.query<AttachmentRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM attachments WHERE message_id = ${messageId}`
    )
    return result.rows.map(mapRowToAttachment)
  },

  async findByMessageIds(client: PoolClient, messageIds: string[]): Promise<Map<string, Attachment[]>> {
    if (messageIds.length === 0) return new Map()
    const result = await client.query<AttachmentRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM attachments WHERE message_id = ANY(${messageIds})`
    )

    const byMessage = new Map<string, Attachment[]>()
    for (const row of result.rows) {
      if (!row.message_id) continue
      const existing = byMessage.get(row.message_id) ?? []
      existing.push(mapRowToAttachment(row))
      byMessage.set(row.message_id, existing)
    }
    return byMessage
  },

  async insert(client: PoolClient, params: InsertAttachmentParams): Promise<Attachment> {
    const result = await client.query<AttachmentRow>(sql`
      INSERT INTO attachments (
        id, workspace_id, stream_id,
        filename, mime_type, size_bytes,
        storage_provider, storage_path
      )
      VALUES (
        ${params.id},
        ${params.workspaceId},
        ${params.streamId},
        ${params.filename},
        ${params.mimeType},
        ${params.sizeBytes},
        ${params.storageProvider ?? "s3"},
        ${params.storagePath}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRowToAttachment(result.rows[0])
  },

  async attachToMessage(client: PoolClient, attachmentIds: string[], messageId: string): Promise<number> {
    if (attachmentIds.length === 0) return 0
    const result = await client.query(sql`
      UPDATE attachments
      SET message_id = ${messageId}
      WHERE id = ANY(${attachmentIds}) AND message_id IS NULL
    `)
    return result.rowCount ?? 0
  },

  async delete(client: PoolClient, id: string): Promise<boolean> {
    const result = await client.query(sql`
      DELETE FROM attachments WHERE id = ${id}
    `)
    return (result.rowCount ?? 0) > 0
  },
}
