import { sql, type Querier } from "../../db"
import { listAccessibleStreamIds } from "../streams"

interface AttachmentReferenceRow {
  id: string
  workspace_id: string
  attachment_id: string
  message_id: string
  stream_id: string
  created_at: Date
}

export interface AttachmentReference {
  id: string
  workspaceId: string
  attachmentId: string
  messageId: string
  streamId: string
  createdAt: Date
}

export interface InsertAttachmentReferenceParams {
  id: string
  workspaceId: string
  attachmentId: string
  messageId: string
  streamId: string
}

function mapRow(row: AttachmentReferenceRow): AttachmentReference {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    attachmentId: row.attachment_id,
    messageId: row.message_id,
    streamId: row.stream_id,
    createdAt: row.created_at,
  }
}

const SELECT_FIELDS = `id, workspace_id, attachment_id, message_id, stream_id, created_at`

export const AttachmentReferenceRepository = {
  /**
   * Insert one row per (attachment, referencing message) pair. Idempotent
   * on `(attachment_id, message_id)` so repeat sends of the same payload
   * during a retry don't error out and the backfill can coexist with
   * application-level inserts.
   */
  async insertMany(client: Querier, params: InsertAttachmentReferenceParams[]): Promise<number> {
    if (params.length === 0) return 0
    const ids = params.map((p) => p.id)
    const workspaceIds = params.map((p) => p.workspaceId)
    const attachmentIds = params.map((p) => p.attachmentId)
    const messageIds = params.map((p) => p.messageId)
    const streamIds = params.map((p) => p.streamId)
    const result = await client.query(sql`
      INSERT INTO attachment_references (id, workspace_id, attachment_id, message_id, stream_id)
      SELECT * FROM UNNEST(
        ${ids}::text[],
        ${workspaceIds}::text[],
        ${attachmentIds}::text[],
        ${messageIds}::text[],
        ${streamIds}::text[]
      )
      ON CONFLICT (attachment_id, message_id) DO NOTHING
    `)
    return result.rowCount ?? 0
  },

  async findByAttachmentId(db: Querier, attachmentId: string): Promise<AttachmentReference[]> {
    const result = await db.query<AttachmentReferenceRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM attachment_references
      WHERE attachment_id = ${attachmentId}
    `)
    return result.rows.map(mapRow)
  },

  /**
   * Returns true when the viewer has read access to at least one stream
   * that references the attachment. Composes `findByAttachmentId` with
   * `listAccessibleStreamIds` so callers don't have to assemble the
   * stream-access check themselves; mirrors the shape of
   * `SharedMessageRepository.listSourcesGrantedToViewer`.
   */
  async hasViewerAccessByReference(
    db: Querier,
    workspaceId: string,
    userId: string,
    attachmentId: string
  ): Promise<boolean> {
    const refs = await this.findByAttachmentId(db, attachmentId)
    if (refs.length === 0) return false
    const candidateStreamIds = [...new Set(refs.map((r) => r.streamId))]
    const reachable = await listAccessibleStreamIds(db, workspaceId, userId, candidateStreamIds)
    return reachable.size > 0
  },
}
