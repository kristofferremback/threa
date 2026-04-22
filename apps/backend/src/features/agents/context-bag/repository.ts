import type { Querier } from "../../../db"
import { sql } from "../../../db"
import type { ContextBag, ContextIntent } from "@threa/types"
import { streamContextAttachmentId } from "../../../lib/id"
import type { LastRenderedSnapshot, StoredContextBag } from "./types"

interface StreamContextAttachmentRow {
  id: string
  workspace_id: string
  stream_id: string
  intent: string
  refs: unknown
  last_rendered: unknown
  created_by: string
  created_at: Date
  updated_at: Date
}

function mapRow(row: StreamContextAttachmentRow): StoredContextBag {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    streamId: row.stream_id,
    intent: row.intent as ContextIntent,
    refs: (row.refs ?? []) as ContextBag["refs"],
    lastRendered: (row.last_rendered ?? null) as LastRenderedSnapshot | null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT_FIELDS = `id, workspace_id, stream_id, intent, refs, last_rendered, created_by, created_at, updated_at`

export interface InsertContextBagParams {
  workspaceId: string
  streamId: string
  intent: ContextIntent
  refs: ContextBag["refs"]
  createdBy: string
}

export const ContextBagRepository = {
  async findByStream(db: Querier, streamId: string): Promise<StoredContextBag | null> {
    const result = await db.query<StreamContextAttachmentRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM stream_context_attachments
      WHERE stream_id = ${streamId}
      LIMIT 1
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async insert(db: Querier, params: InsertContextBagParams): Promise<StoredContextBag> {
    const id = streamContextAttachmentId()
    const refsJson = JSON.stringify(params.refs)
    const result = await db.query<StreamContextAttachmentRow>(sql`
      INSERT INTO stream_context_attachments (
        id, workspace_id, stream_id, intent, refs, created_by
      ) VALUES (
        ${id}, ${params.workspaceId}, ${params.streamId}, ${params.intent}, ${refsJson}::jsonb, ${params.createdBy}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRow(result.rows[0])
  },

  async updateLastRendered(db: Querier, id: string, snapshot: LastRenderedSnapshot): Promise<void> {
    const json = JSON.stringify(snapshot)
    await db.query(sql`
      UPDATE stream_context_attachments
      SET last_rendered = ${json}::jsonb, updated_at = NOW()
      WHERE id = ${id}
    `)
  },
}
