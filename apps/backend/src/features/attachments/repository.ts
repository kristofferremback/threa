import { sql, type Querier } from "../../db"
import {
  AttachmentSafetyStatuses,
  ProcessingStatuses,
  type StorageProvider,
  type ProcessingStatus,
  type ExtractionContentType,
  type AttachmentSafetyStatus,
} from "@threa/types"

// Internal row type (snake_case, not exported)
interface AttachmentRow {
  id: string
  workspace_id: string
  stream_id: string | null
  message_id: string | null
  uploaded_by: string | null
  filename: string
  mime_type: string
  size_bytes: string
  storage_provider: string
  storage_path: string
  processing_status: string
  safety_status: string
  created_at: Date
}

// Domain type (camelCase, exported)
export interface Attachment {
  id: string
  workspaceId: string
  streamId: string | null
  messageId: string | null
  uploadedBy: string | null
  filename: string
  mimeType: string
  sizeBytes: number
  storageProvider: StorageProvider
  storagePath: string
  processingStatus: ProcessingStatus
  safetyStatus: AttachmentSafetyStatus
  createdAt: Date
}

export interface InsertAttachmentParams {
  id: string
  workspaceId: string
  streamId?: string
  uploadedBy: string
  filename: string
  mimeType: string
  sizeBytes: number
  storagePath: string
  storageProvider?: StorageProvider
  safetyStatus?: AttachmentSafetyStatus
}

// Row type for attachments with extraction joined
interface AttachmentWithExtractionRow extends AttachmentRow {
  extraction_content_type: string | null
  extraction_summary: string | null
  extraction_full_text: string | null
}

// Domain type for attachment with extraction
export interface AttachmentWithExtraction extends Attachment {
  extraction: {
    contentType: ExtractionContentType
    summary: string
    fullText: string | null
  } | null
}

function mapRowToAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    streamId: row.stream_id,
    messageId: row.message_id,
    uploadedBy: row.uploaded_by,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    storageProvider: row.storage_provider as StorageProvider,
    storagePath: row.storage_path,
    processingStatus: row.processing_status as ProcessingStatus,
    safetyStatus: row.safety_status as AttachmentSafetyStatus,
    createdAt: row.created_at,
  }
}

function mapRowToAttachmentWithExtraction(row: AttachmentWithExtractionRow): AttachmentWithExtraction {
  return {
    ...mapRowToAttachment(row),
    extraction: row.extraction_content_type
      ? {
          contentType: row.extraction_content_type as ExtractionContentType,
          summary: row.extraction_summary ?? "",
          fullText: row.extraction_full_text,
        }
      : null,
  }
}

const SELECT_FIELDS = `
  id, workspace_id, stream_id, message_id, uploaded_by,
  filename, mime_type, size_bytes,
  storage_provider, storage_path, processing_status, safety_status,
  created_at
`

export const AttachmentRepository = {
  async findById(client: Querier, id: string): Promise<Attachment | null> {
    const result = await client.query<AttachmentRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM attachments WHERE id = ${id}`
    )
    return result.rows[0] ? mapRowToAttachment(result.rows[0]) : null
  },

  async findByIds(client: Querier, ids: string[]): Promise<Attachment[]> {
    if (ids.length === 0) return []
    const result = await client.query<AttachmentRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM attachments WHERE id = ANY(${ids})`
    )
    return result.rows.map(mapRowToAttachment)
  },

  async findByMessageId(client: Querier, messageId: string): Promise<Attachment[]> {
    const result = await client.query<AttachmentRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM attachments WHERE message_id = ${messageId}`
    )
    return result.rows.map(mapRowToAttachment)
  },

  async findByMessageIds(client: Querier, messageIds: string[]): Promise<Map<string, Attachment[]>> {
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

  async findByIdForUpdate(client: Querier, id: string): Promise<Attachment | null> {
    const result = await client.query<AttachmentRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM attachments WHERE id = ${id} FOR UPDATE`
    )
    return result.rows[0] ? mapRowToAttachment(result.rows[0]) : null
  },

  /**
   * Find attachments with their extractions for a list of message IDs.
   * Returns a map from message ID to attachments with extraction data.
   */
  async findByMessageIdsWithExtractions(
    client: Querier,
    messageIds: string[]
  ): Promise<Map<string, AttachmentWithExtraction[]>> {
    if (messageIds.length === 0) return new Map()

    const result = await client.query<AttachmentWithExtractionRow>(sql`
      SELECT
        a.id, a.workspace_id, a.stream_id, a.message_id, a.uploaded_by,
        a.filename, a.mime_type, a.size_bytes,
        a.storage_provider, a.storage_path, a.processing_status, a.safety_status,
        a.created_at,
        e.content_type AS extraction_content_type,
        e.summary AS extraction_summary,
        e.full_text AS extraction_full_text
      FROM attachments a
      LEFT JOIN attachment_extractions e ON e.attachment_id = a.id
      WHERE a.message_id = ANY(${messageIds})
    `)

    const byMessage = new Map<string, AttachmentWithExtraction[]>()
    for (const row of result.rows) {
      if (!row.message_id) continue
      const existing = byMessage.get(row.message_id) ?? []
      existing.push(mapRowToAttachmentWithExtraction(row))
      byMessage.set(row.message_id, existing)
    }
    return byMessage
  },

  async insert(client: Querier, params: InsertAttachmentParams): Promise<Attachment> {
    const result = await client.query<AttachmentRow>(sql`
      INSERT INTO attachments (
        id, workspace_id, stream_id, uploaded_by,
        filename, mime_type, size_bytes,
        storage_provider, storage_path, safety_status
      )
      VALUES (
        ${params.id},
        ${params.workspaceId},
        ${params.streamId ?? null},
        ${params.uploadedBy},
        ${params.filename},
        ${params.mimeType},
        ${params.sizeBytes},
        ${params.storageProvider ?? "s3"},
        ${params.storagePath},
        ${params.safetyStatus ?? AttachmentSafetyStatuses.PENDING_SCAN}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRowToAttachment(result.rows[0])
  },

  async attachToMessage(
    client: Querier,
    attachmentIds: string[],
    messageId: string,
    streamId: string
  ): Promise<number> {
    if (attachmentIds.length === 0) return 0
    const result = await client.query(sql`
      UPDATE attachments
      SET message_id = ${messageId}, stream_id = ${streamId}
      WHERE id = ANY(${attachmentIds}) AND message_id IS NULL AND safety_status = ${AttachmentSafetyStatuses.CLEAN}
    `)
    return result.rowCount ?? 0
  },

  async delete(client: Querier, id: string): Promise<boolean> {
    const result = await client.query(sql`
      DELETE FROM attachments WHERE id = ${id}
    `)
    return (result.rowCount ?? 0) > 0
  },

  /**
   * Update the processing status of an attachment.
   * Returns true if the update was applied, false otherwise.
   *
   * @param onlyIfStatus - If provided, only update if current status matches this value (atomic transition)
   * @param onlyIfStatusIn - If provided, only update if current status is in this array (for retries)
   */
  async updateProcessingStatus(
    client: Querier,
    id: string,
    status: ProcessingStatus,
    options?: { onlyIfStatus?: ProcessingStatus; onlyIfStatusIn?: ProcessingStatus[] }
  ): Promise<boolean> {
    if (options?.onlyIfStatusIn) {
      const result = await client.query(sql`
        UPDATE attachments
        SET processing_status = ${status}
        WHERE id = ${id} AND processing_status = ANY(${options.onlyIfStatusIn})
      `)
      return (result.rowCount ?? 0) > 0
    }

    if (options?.onlyIfStatus) {
      const result = await client.query(sql`
        UPDATE attachments
        SET processing_status = ${status}
        WHERE id = ${id} AND processing_status = ${options.onlyIfStatus}
      `)
      return (result.rowCount ?? 0) > 0
    }

    const result = await client.query(sql`
      UPDATE attachments
      SET processing_status = ${status}
      WHERE id = ${id}
    `)
    return (result.rowCount ?? 0) > 0
  },

  async updateSafetyStatus(
    client: Querier,
    id: string,
    status: AttachmentSafetyStatus,
    options?: { onlyIfStatus?: AttachmentSafetyStatus; onlyIfStatusIn?: AttachmentSafetyStatus[] }
  ): Promise<boolean> {
    if (options?.onlyIfStatusIn) {
      const result = await client.query(sql`
        UPDATE attachments
        SET safety_status = ${status}
        WHERE id = ${id} AND safety_status = ANY(${options.onlyIfStatusIn})
      `)
      return (result.rowCount ?? 0) > 0
    }

    if (options?.onlyIfStatus) {
      const result = await client.query(sql`
        UPDATE attachments
        SET safety_status = ${status}
        WHERE id = ${id} AND safety_status = ${options.onlyIfStatus}
      `)
      return (result.rowCount ?? 0) > 0
    }

    const result = await client.query(sql`
      UPDATE attachments
      SET safety_status = ${status}
      WHERE id = ${id}
    `)
    return (result.rowCount ?? 0) > 0
  },

  async quarantineStalePendingScans(client: Querier, options: { olderThan: Date; limit: number }): Promise<string[]> {
    const result = await client.query<{ id: string }>(sql`
      WITH stale AS (
        SELECT id
        FROM attachments
        WHERE safety_status = ${AttachmentSafetyStatuses.PENDING_SCAN}
          AND created_at < ${options.olderThan}
        ORDER BY created_at ASC
        LIMIT ${options.limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE attachments a
      SET
        safety_status = ${AttachmentSafetyStatuses.QUARANTINED},
        processing_status = ${ProcessingStatuses.SKIPPED}
      FROM stale
      WHERE a.id = stale.id
        AND a.safety_status = ${AttachmentSafetyStatuses.PENDING_SCAN}
      RETURNING a.id
    `)

    return result.rows.map((row) => row.id)
  },

  /**
   * Search attachments with their extractions joined.
   * Searches by filename and extraction content (summary, full_text).
   */
  async searchWithExtractions(
    client: Querier,
    opts: {
      workspaceId: string
      streamIds: string[]
      query: string
      contentTypes?: ExtractionContentType[]
      limit?: number
    }
  ): Promise<AttachmentWithExtraction[]> {
    const { workspaceId, streamIds, query, contentTypes, limit = 20 } = opts

    if (streamIds.length === 0) return []

    const searchPattern = `%${query}%`

    // Use separate queries to avoid nested sql template issues
    if (contentTypes?.length) {
      const result = await client.query<AttachmentWithExtractionRow>(sql`
        SELECT
          a.id, a.workspace_id, a.stream_id, a.message_id, a.uploaded_by,
          a.filename, a.mime_type, a.size_bytes,
          a.storage_provider, a.storage_path, a.processing_status, a.safety_status,
          a.created_at,
          e.content_type AS extraction_content_type,
          e.summary AS extraction_summary,
          e.full_text AS extraction_full_text
        FROM attachments a
        LEFT JOIN attachment_extractions e ON e.attachment_id = a.id
        WHERE a.workspace_id = ${workspaceId}
          AND a.stream_id = ANY(${streamIds})
          AND (
            a.filename ILIKE ${searchPattern}
            OR e.summary ILIKE ${searchPattern}
            OR e.full_text ILIKE ${searchPattern}
          )
          AND e.content_type = ANY(${contentTypes})
        ORDER BY a.created_at DESC
        LIMIT ${limit}
      `)
      return result.rows.map(mapRowToAttachmentWithExtraction)
    }

    const result = await client.query<AttachmentWithExtractionRow>(sql`
      SELECT
        a.id, a.workspace_id, a.stream_id, a.message_id, a.uploaded_by,
        a.filename, a.mime_type, a.size_bytes,
        a.storage_provider, a.storage_path, a.processing_status, a.safety_status,
        a.created_at,
        e.content_type AS extraction_content_type,
        e.summary AS extraction_summary,
        e.full_text AS extraction_full_text
      FROM attachments a
      LEFT JOIN attachment_extractions e ON e.attachment_id = a.id
      WHERE a.workspace_id = ${workspaceId}
        AND a.stream_id = ANY(${streamIds})
        AND (
          a.filename ILIKE ${searchPattern}
          OR e.summary ILIKE ${searchPattern}
          OR e.full_text ILIKE ${searchPattern}
        )
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `)

    return result.rows.map(mapRowToAttachmentWithExtraction)
  },
}
