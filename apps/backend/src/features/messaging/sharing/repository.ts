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
   * Returns every share-row whose source is one of the given message ids,
   * scoped to `workspaceId` (INV-8). Used by the outbox handler to find
   * target streams to invalidate when a source message is edited or deleted,
   * and by hydration to resolve per-viewer access grants on pointer renders.
   */
  async listBySourceMessageIds(db: Querier, workspaceId: string, sourceMessageIds: string[]): Promise<SharedMessage[]> {
    if (sourceMessageIds.length === 0) return []
    const result = await db.query<SharedMessageRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM shared_messages
      WHERE workspace_id = ${workspaceId}
        AND source_message_id = ANY(${sourceMessageIds})
    `)
    return result.rows.map(mapRow)
  },

  /**
   * Remove every share-row created by a given share-message. Used on edit
   * to make share-recording idempotent: the service deletes existing rows
   * for a `share_message_id` and re-inserts from the new content, so the
   * row set always reflects the current message body.
   */
  async deleteByShareMessageId(db: Querier, workspaceId: string, shareMessageId: string): Promise<void> {
    await db.query(sql`
      DELETE FROM shared_messages
      WHERE workspace_id = ${workspaceId}
        AND share_message_id = ${shareMessageId}
    `)
  },

  /**
   * Returns the subset of `sourceMessageIds` for which the viewer has been
   * granted read access via at least one share whose `target_stream_id` the
   * viewer can access (per `listAccessibleStreamIds` semantics — direct
   * member, public visibility, or thread inheriting from root). Set-based,
   * single SQL round-trip.
   *
   * Used by recursive pointer hydration (D8) to decide per-viewer access at
   * each level of a re-share chain: a viewer who isn't directly a member of
   * the source stream still sees the source content if they have any share
   * grant reaching them.
   */
  async listSourcesGrantedToViewer(
    db: Querier,
    workspaceId: string,
    userId: string,
    sourceMessageIds: readonly string[]
  ): Promise<Set<string>> {
    if (sourceMessageIds.length === 0) return new Set()
    const result = await db.query<{ source_message_id: string }>(sql`
      SELECT DISTINCT sm.source_message_id
      FROM shared_messages sm
      JOIN streams t ON t.id = sm.target_stream_id
      LEFT JOIN streams root ON root.id = t.root_stream_id
      WHERE sm.workspace_id = ${workspaceId}
        AND sm.source_message_id = ANY(${sourceMessageIds as string[]})
        AND (
          (t.root_stream_id IS NULL AND (
            t.visibility = 'public'
            OR EXISTS (
              SELECT 1 FROM stream_members
              WHERE stream_id = t.id AND member_id = ${userId}
            )
          ))
          OR
          (t.root_stream_id IS NOT NULL AND root.id IS NOT NULL AND (
            root.visibility = 'public'
            OR EXISTS (
              SELECT 1 FROM stream_members
              WHERE stream_id = t.root_stream_id AND member_id = ${userId}
            )
          ))
        )
    `)
    return new Set(result.rows.map((r) => r.source_message_id))
  },
}
