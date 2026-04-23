import type { Querier } from "../../../db"
import { sql } from "../../../db"
import { type ShareFlavor } from "@threa/types"

// Internal row type (snake_case, not exported)
interface SharedMessageRow {
  id: string
  workspace_id: string
  share_message_id: string
  source_message_id: string
  source_stream_id: string
  target_stream_id: string
  flavor: string
  created_by: string
  created_at: Date
}

// Domain type (camelCase, exported)
export interface SharedMessage {
  id: string
  workspaceId: string
  shareMessageId: string
  sourceMessageId: string
  sourceStreamId: string
  targetStreamId: string
  flavor: ShareFlavor
  createdBy: string
  createdAt: Date
}

export interface InsertSharedMessageParams {
  id: string
  workspaceId: string
  shareMessageId: string
  sourceMessageId: string
  sourceStreamId: string
  targetStreamId: string
  flavor: ShareFlavor
  createdBy: string
}

function mapRow(row: SharedMessageRow): SharedMessage {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    shareMessageId: row.share_message_id,
    sourceMessageId: row.source_message_id,
    sourceStreamId: row.source_stream_id,
    targetStreamId: row.target_stream_id,
    flavor: row.flavor as ShareFlavor,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

const SELECT_FIELDS = `
  id, workspace_id, share_message_id, source_message_id, source_stream_id,
  target_stream_id, flavor, created_by, created_at
`

export const SharedMessageRepository = {
  async insert(db: Querier, params: InsertSharedMessageParams): Promise<SharedMessage> {
    const result = await db.query<SharedMessageRow>(sql`
      INSERT INTO shared_messages (
        id, workspace_id, share_message_id, source_message_id, source_stream_id,
        target_stream_id, flavor, created_by
      )
      VALUES (
        ${params.id}, ${params.workspaceId}, ${params.shareMessageId}, ${params.sourceMessageId},
        ${params.sourceStreamId}, ${params.targetStreamId}, ${params.flavor}, ${params.createdBy}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRow(result.rows[0])
  },

  /**
   * Returns every share-row whose source is one of the given message ids.
   * Used by the outbox handler to find target streams to invalidate when a
   * source message is edited or deleted, and by hydration to resolve
   * per-viewer access grants on pointer renders.
   */
  async listBySourceMessageIds(db: Querier, sourceMessageIds: string[]): Promise<SharedMessage[]> {
    if (sourceMessageIds.length === 0) return []
    const result = await db.query<SharedMessageRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM shared_messages
      WHERE source_message_id = ANY(${sourceMessageIds})
    `)
    return result.rows.map(mapRow)
  },
}
