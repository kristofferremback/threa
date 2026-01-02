import { PoolClient } from "pg"
import { sql } from "../db"
import type { StreamType, Visibility, CompanionMode } from "@threa/types"

export type { StreamType, Visibility, CompanionMode }

// Internal row type (snake_case, not exported)
interface StreamRow {
  id: string
  workspace_id: string
  type: string
  display_name: string | null
  slug: string | null
  description: string | null
  visibility: string
  parent_stream_id: string | null
  parent_message_id: string | null
  root_stream_id: string | null
  companion_mode: string
  companion_persona_id: string | null
  created_by: string
  created_at: Date
  updated_at: Date
  archived_at: Date | null
  display_name_generated_at: Date | null
}

export interface Stream {
  id: string
  workspaceId: string
  type: StreamType
  displayName: string | null
  slug: string | null
  description: string | null
  visibility: Visibility
  parentStreamId: string | null
  parentMessageId: string | null
  rootStreamId: string | null
  companionMode: CompanionMode
  companionPersonaId: string | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
  displayNameGeneratedAt: Date | null
}

export interface InsertStreamParams {
  id: string
  workspaceId: string
  type: StreamType
  displayName?: string
  slug?: string
  description?: string
  visibility?: Visibility
  parentStreamId?: string
  parentMessageId?: string
  rootStreamId?: string
  companionMode?: CompanionMode
  companionPersonaId?: string
  createdBy: string
}

export interface UpdateStreamParams {
  displayName?: string
  description?: string
  companionMode?: CompanionMode
  companionPersonaId?: string | null
  archivedAt?: Date | null
  displayNameGeneratedAt?: Date | null
}

function mapRowToStream(row: StreamRow): Stream {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type as StreamType,
    displayName: row.display_name,
    slug: row.slug,
    description: row.description,
    visibility: row.visibility as Visibility,
    parentStreamId: row.parent_stream_id,
    parentMessageId: row.parent_message_id,
    rootStreamId: row.root_stream_id,
    companionMode: row.companion_mode as CompanionMode,
    companionPersonaId: row.companion_persona_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    displayNameGeneratedAt: row.display_name_generated_at,
  }
}

const SELECT_FIELDS = `
  id, workspace_id, type, display_name, slug, description, visibility,
  parent_stream_id, parent_message_id, root_stream_id,
  companion_mode, companion_persona_id,
  created_by, created_at, updated_at, archived_at, display_name_generated_at
`

export const StreamRepository = {
  async findById(client: PoolClient, id: string): Promise<Stream | null> {
    const result = await client.query<StreamRow>(sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams WHERE id = ${id}`)
    return result.rows[0] ? mapRowToStream(result.rows[0]) : null
  },

  /**
   * Locks the stream row for update, skipping if already locked.
   * Returns null if not found or already locked by another transaction.
   */
  async findByIdForUpdate(client: PoolClient, id: string): Promise<Stream | null> {
    const result = await client.query<StreamRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams WHERE id = ${id} FOR UPDATE SKIP LOCKED`
    )
    return result.rows[0] ? mapRowToStream(result.rows[0]) : null
  },

  async list(
    client: PoolClient,
    workspaceId: string,
    filters?: {
      types?: StreamType[]
      parentStreamId?: string
      userMembershipStreamIds?: string[]
      archiveStatus?: ("active" | "archived")[]
    }
  ): Promise<Stream[]> {
    const types = filters?.types
    const parentStreamId = filters?.parentStreamId
    const userMembershipStreamIds = filters?.userMembershipStreamIds
    const archiveStatus = filters?.archiveStatus

    // Archive status filtering logic:
    // - Default (undefined/empty) → active only
    // - ["active"] → active only
    // - ["archived"] → archived only
    // - ["active", "archived"] → all streams (no filter)
    const includeActive = !archiveStatus || archiveStatus.length === 0 || archiveStatus.includes("active")
    const includeArchived = archiveStatus?.includes("archived") ?? false
    const filterAll = includeActive && includeArchived

    if (parentStreamId) {
      const result = await client.query<StreamRow>(
        sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
            WHERE workspace_id = ${workspaceId}
              AND parent_stream_id = ${parentStreamId}
              AND (${filterAll} OR (${includeArchived} AND archived_at IS NOT NULL) OR (${!includeArchived} AND archived_at IS NULL))
            ORDER BY created_at DESC`
      )
      return result.rows.map(mapRowToStream)
    }

    // Build query with visibility filter if user's membership stream IDs provided
    if (userMembershipStreamIds !== undefined) {
      if (types && types.length > 0) {
        const result = await client.query<StreamRow>(
          sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
              WHERE workspace_id = ${workspaceId}
                AND type = ANY(${types})
                AND (${filterAll} OR (${includeArchived} AND archived_at IS NOT NULL) OR (${!includeArchived} AND archived_at IS NULL))
                AND (visibility = 'public' OR id = ANY(${userMembershipStreamIds}))
              ORDER BY created_at DESC`
        )
        return result.rows.map(mapRowToStream)
      }

      const result = await client.query<StreamRow>(
        sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
            WHERE workspace_id = ${workspaceId}
              AND (${filterAll} OR (${includeArchived} AND archived_at IS NOT NULL) OR (${!includeArchived} AND archived_at IS NULL))
              AND (visibility = 'public' OR id = ANY(${userMembershipStreamIds}))
            ORDER BY created_at DESC`
      )
      return result.rows.map(mapRowToStream)
    }

    if (types && types.length > 0) {
      const result = await client.query<StreamRow>(
        sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
            WHERE workspace_id = ${workspaceId}
              AND type = ANY(${types})
              AND (${filterAll} OR (${includeArchived} AND archived_at IS NOT NULL) OR (${!includeArchived} AND archived_at IS NULL))
            ORDER BY created_at DESC`
      )
      return result.rows.map(mapRowToStream)
    }

    const result = await client.query<StreamRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
          WHERE workspace_id = ${workspaceId}
            AND (${filterAll} OR (${includeArchived} AND archived_at IS NOT NULL) OR (${!includeArchived} AND archived_at IS NULL))
          ORDER BY created_at DESC`
    )
    return result.rows.map(mapRowToStream)
  },

  async insert(client: PoolClient, params: InsertStreamParams): Promise<Stream> {
    const result = await client.query<StreamRow>(sql`
      INSERT INTO streams (
        id, workspace_id, type, display_name, slug, description, visibility,
        parent_stream_id, parent_message_id, root_stream_id,
        companion_mode, companion_persona_id, created_by
      ) VALUES (
        ${params.id},
        ${params.workspaceId},
        ${params.type},
        ${params.displayName ?? null},
        ${params.slug ?? null},
        ${params.description ?? null},
        ${params.visibility ?? "private"},
        ${params.parentStreamId ?? null},
        ${params.parentMessageId ?? null},
        ${params.rootStreamId ?? null},
        ${params.companionMode ?? "off"},
        ${params.companionPersonaId ?? null},
        ${params.createdBy}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRowToStream(result.rows[0])
  },

  /**
   * Atomically insert a thread or return the existing one.
   * Uses ON CONFLICT DO NOTHING to handle race conditions where multiple
   * concurrent requests try to create a thread for the same parent message.
   *
   * @returns { stream, created } - The stream and whether it was newly created
   */
  async insertThreadOrFind(
    client: PoolClient,
    params: InsertStreamParams
  ): Promise<{ stream: Stream; created: boolean }> {
    // Try to insert with ON CONFLICT DO NOTHING
    const insertResult = await client.query<StreamRow>(sql`
      INSERT INTO streams (
        id, workspace_id, type, display_name, slug, description, visibility,
        parent_stream_id, parent_message_id, root_stream_id,
        companion_mode, companion_persona_id, created_by
      ) VALUES (
        ${params.id},
        ${params.workspaceId},
        ${params.type},
        ${params.displayName ?? null},
        ${params.slug ?? null},
        ${params.description ?? null},
        ${params.visibility ?? "private"},
        ${params.parentStreamId ?? null},
        ${params.parentMessageId ?? null},
        ${params.rootStreamId ?? null},
        ${params.companionMode ?? "off"},
        ${params.companionPersonaId ?? null},
        ${params.createdBy}
      )
      ON CONFLICT (parent_stream_id, parent_message_id)
        WHERE parent_message_id IS NOT NULL
      DO NOTHING
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)

    if (insertResult.rows.length > 0) {
      // Insert succeeded - this is a new thread
      return { stream: mapRowToStream(insertResult.rows[0]), created: true }
    }

    // Insert was no-op due to conflict - find the existing thread
    const existing = await this.findByParentMessage(client, params.parentStreamId!, params.parentMessageId!)
    if (!existing) {
      // This shouldn't happen - if ON CONFLICT triggered, the row exists
      throw new Error("Thread creation conflict but existing thread not found")
    }
    return { stream: existing, created: false }
  },

  async update(client: PoolClient, id: string, params: UpdateStreamParams): Promise<Stream | null> {
    const sets: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (params.displayName !== undefined) {
      sets.push(`display_name = $${paramIndex++}`)
      values.push(params.displayName)
    }
    if (params.description !== undefined) {
      sets.push(`description = $${paramIndex++}`)
      values.push(params.description)
    }
    if (params.companionMode !== undefined) {
      sets.push(`companion_mode = $${paramIndex++}`)
      values.push(params.companionMode)
    }
    if (params.companionPersonaId !== undefined) {
      sets.push(`companion_persona_id = $${paramIndex++}`)
      values.push(params.companionPersonaId)
    }
    if (params.archivedAt !== undefined) {
      sets.push(`archived_at = $${paramIndex++}`)
      values.push(params.archivedAt)
    }
    if (params.displayNameGeneratedAt !== undefined) {
      sets.push(`display_name_generated_at = $${paramIndex++}`)
      values.push(params.displayNameGeneratedAt)
    }

    if (sets.length === 0) return this.findById(client, id)

    sets.push(`updated_at = NOW()`)
    values.push(id)

    const query = `
      UPDATE streams SET ${sets.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING ${SELECT_FIELDS}
    `
    const result = await client.query<StreamRow>(query, values)
    return result.rows[0] ? mapRowToStream(result.rows[0]) : null
  },

  async slugExistsInWorkspace(client: PoolClient, workspaceId: string, slug: string): Promise<boolean> {
    const result = await client.query(sql`
      SELECT 1 FROM streams
      WHERE workspace_id = ${workspaceId} AND slug = ${slug}
    `)
    return result.rows.length > 0
  },

  async findByParentMessage(
    client: PoolClient,
    parentStreamId: string,
    parentMessageId: string
  ): Promise<Stream | null> {
    const result = await client.query<StreamRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
      WHERE parent_stream_id = ${parentStreamId}
        AND parent_message_id = ${parentMessageId}
    `)
    return result.rows[0] ? mapRowToStream(result.rows[0]) : null
  },

  /**
   * Find all threads for messages in a given parent stream.
   * Returns a map of parentMessageId -> threadStreamId
   */
  async findThreadsForMessages(client: PoolClient, parentStreamId: string): Promise<Map<string, string>> {
    const result = await client.query<{ parent_message_id: string; id: string }>(sql`
      SELECT parent_message_id, id FROM streams
      WHERE parent_stream_id = ${parentStreamId}
        AND parent_message_id IS NOT NULL
    `)
    const map = new Map<string, string>()
    for (const row of result.rows) {
      map.set(row.parent_message_id, row.id)
    }
    return map
  },

  /**
   * Find all threads for messages in a given parent stream, including reply counts.
   * Returns a map of parentMessageId -> { threadId, replyCount }
   * This combines findThreadsForMessages + countMessagesByStreams in a single query.
   */
  async findThreadsWithReplyCounts(
    client: PoolClient,
    parentStreamId: string
  ): Promise<Map<string, { threadId: string; replyCount: number }>> {
    const result = await client.query<{ parent_message_id: string; id: string; reply_count: string }>(sql`
      SELECT
        s.parent_message_id,
        s.id,
        COUNT(e.id)::text AS reply_count
      FROM streams s
      LEFT JOIN stream_events e ON e.stream_id = s.id AND e.event_type = 'message_created'
      WHERE s.parent_stream_id = ${parentStreamId}
        AND s.parent_message_id IS NOT NULL
      GROUP BY s.id, s.parent_message_id
    `)
    const map = new Map<string, { threadId: string; replyCount: number }>()
    for (const row of result.rows) {
      map.set(row.parent_message_id, {
        threadId: row.id,
        replyCount: parseInt(row.reply_count, 10),
      })
    }
    return map
  },
}
