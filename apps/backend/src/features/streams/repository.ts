import type { Querier } from "../../db"
import { sql } from "../../db"
import type { AuthorType, StreamType, Visibility, CompanionMode } from "@threa/types"
import { parseArchiveStatusFilter, type ArchiveStatus } from "../../lib/sql-filters"

export type { StreamType, Visibility, CompanionMode, ArchiveStatus }

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

/** Preview of the last message in a stream for sidebar display */
export interface LastMessagePreview {
  authorId: string
  authorType: AuthorType
  content: any // ProseMirror JSONContent
  createdAt: Date
}

/** Stream with optional last message preview, for sidebar listing */
export interface StreamWithPreview extends Stream {
  lastMessagePreview: LastMessagePreview | null
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

/** Row type for stream with last message preview (from CTE query) */
interface StreamWithPreviewRow extends StreamRow {
  last_message_author_id: string | null
  last_message_author_type: string | null
  last_message_content: any | null // ProseMirror JSONContent
  last_message_at: Date | null
}

function mapRowToStreamWithPreview(row: StreamWithPreviewRow): StreamWithPreview {
  const stream = mapRowToStream(row)
  const lastMessagePreview: LastMessagePreview | null =
    row.last_message_author_id && row.last_message_content && row.last_message_at
      ? {
          authorId: row.last_message_author_id,
          authorType: row.last_message_author_type as AuthorType,
          content: row.last_message_content,
          createdAt: row.last_message_at,
        }
      : null

  return {
    ...stream,
    lastMessagePreview,
  }
}

const SELECT_FIELDS = `
  id, workspace_id, type, display_name, slug, description, visibility,
  parent_stream_id, parent_message_id, root_stream_id,
  companion_mode, companion_persona_id,
  created_by, created_at, updated_at, archived_at, display_name_generated_at
`

export const StreamRepository = {
  async findById(db: Querier, id: string): Promise<Stream | null> {
    const result = await db.query<StreamRow>(sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams WHERE id = ${id}`)
    return result.rows[0] ? mapRowToStream(result.rows[0]) : null
  },

  /**
   * Locks the stream row for update, skipping if already locked.
   * Returns null if not found or already locked by another transaction.
   */
  async findByIdForUpdate(db: Querier, id: string): Promise<Stream | null> {
    const result = await db.query<StreamRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams WHERE id = ${id} FOR UPDATE SKIP LOCKED`
    )
    return result.rows[0] ? mapRowToStream(result.rows[0]) : null
  },

  async findByIds(db: Querier, ids: string[]): Promise<Stream[]> {
    if (ids.length === 0) return []
    const result = await db.query<StreamRow>(sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams WHERE id = ANY(${ids})`)
    return result.rows.map(mapRowToStream)
  },

  /**
   * Find a stream by its slug within a workspace.
   * Slugs are case-insensitive for matching.
   */
  async findBySlug(db: Querier, workspaceId: string, slug: string): Promise<Stream | null> {
    const result = await db.query<StreamRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
          WHERE workspace_id = ${workspaceId} AND LOWER(slug) = LOWER(${slug})
          LIMIT 1`
    )
    return result.rows[0] ? mapRowToStream(result.rows[0]) : null
  },

  async list(
    db: Querier,
    workspaceId: string,
    filters?: {
      types?: StreamType[]
      parentStreamId?: string
      userMembershipStreamIds?: string[]
      archiveStatus?: ArchiveStatus[]
    }
  ): Promise<Stream[]> {
    const types = filters?.types
    const parentStreamId = filters?.parentStreamId
    const userMembershipStreamIds = filters?.userMembershipStreamIds
    const archiveStatus = filters?.archiveStatus

    const { includeActive, includeArchived, filterAll } = parseArchiveStatusFilter(archiveStatus)

    if (parentStreamId) {
      const result = await db.query<StreamRow>(
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
        const result = await db.query<StreamRow>(
          sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
              WHERE workspace_id = ${workspaceId}
                AND type = ANY(${types})
                AND (${filterAll} OR (${includeArchived} AND archived_at IS NOT NULL) OR (${!includeArchived} AND archived_at IS NULL))
                AND (visibility = 'public' OR id = ANY(${userMembershipStreamIds}))
              ORDER BY created_at DESC`
        )
        return result.rows.map(mapRowToStream)
      }

      const result = await db.query<StreamRow>(
        sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
            WHERE workspace_id = ${workspaceId}
              AND (${filterAll} OR (${includeArchived} AND archived_at IS NOT NULL) OR (${!includeArchived} AND archived_at IS NULL))
              AND (visibility = 'public' OR id = ANY(${userMembershipStreamIds}))
            ORDER BY created_at DESC`
      )
      return result.rows.map(mapRowToStream)
    }

    if (types && types.length > 0) {
      const result = await db.query<StreamRow>(
        sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
            WHERE workspace_id = ${workspaceId}
              AND type = ANY(${types})
              AND (${filterAll} OR (${includeArchived} AND archived_at IS NOT NULL) OR (${!includeArchived} AND archived_at IS NULL))
            ORDER BY created_at DESC`
      )
      return result.rows.map(mapRowToStream)
    }

    const result = await db.query<StreamRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
          WHERE workspace_id = ${workspaceId}
            AND (${filterAll} OR (${includeArchived} AND archived_at IS NOT NULL) OR (${!includeArchived} AND archived_at IS NULL))
          ORDER BY created_at DESC`
    )
    return result.rows.map(mapRowToStream)
  },

  /**
   * List streams with last message preview, ordered by most recent activity.
   * Uses a CTE for efficient fetching of last message per stream.
   */
  async listWithPreviews(
    db: Querier,
    workspaceId: string,
    filters?: {
      types?: StreamType[]
      userMembershipStreamIds?: string[]
      archiveStatus?: ArchiveStatus[]
    }
  ): Promise<StreamWithPreview[]> {
    const types = filters?.types
    const userMembershipStreamIds = filters?.userMembershipStreamIds
    const archiveStatus = filters?.archiveStatus

    const { includeActive, includeArchived, filterAll } = parseArchiveStatusFilter(archiveStatus)

    // CTE to get last message per stream
    const SELECT_WITH_PREVIEW = `
      WITH last_messages AS (
        SELECT DISTINCT ON (stream_id)
          stream_id,
          author_id,
          author_type,
          content_json,
          created_at
        FROM messages
        WHERE deleted_at IS NULL
        ORDER BY stream_id, created_at DESC
      )
      SELECT
        s.${SELECT_FIELDS.split(",")
          .map((f) => f.trim())
          .join(", s.")},
        lm.author_id as last_message_author_id,
        lm.author_type as last_message_author_type,
        lm.content_json as last_message_content,
        lm.created_at as last_message_at
      FROM streams s
      LEFT JOIN last_messages lm ON lm.stream_id = s.id
    `

    // Build query with visibility filter if user's membership stream IDs provided
    if (userMembershipStreamIds !== undefined) {
      if (types && types.length > 0) {
        const result = await db.query<StreamWithPreviewRow>(
          sql`${sql.raw(SELECT_WITH_PREVIEW)}
              WHERE s.workspace_id = ${workspaceId}
                AND s.type = ANY(${types})
                AND (${filterAll} OR (${includeArchived} AND s.archived_at IS NOT NULL) OR (${!includeArchived} AND s.archived_at IS NULL))
                AND (s.visibility = 'public' OR s.id = ANY(${userMembershipStreamIds}))
              ORDER BY COALESCE(lm.created_at, s.created_at) DESC`
        )
        return result.rows.map(mapRowToStreamWithPreview)
      }

      const result = await db.query<StreamWithPreviewRow>(
        sql`${sql.raw(SELECT_WITH_PREVIEW)}
            WHERE s.workspace_id = ${workspaceId}
              AND (${filterAll} OR (${includeArchived} AND s.archived_at IS NOT NULL) OR (${!includeArchived} AND s.archived_at IS NULL))
              AND (s.visibility = 'public' OR s.id = ANY(${userMembershipStreamIds}))
            ORDER BY COALESCE(lm.created_at, s.created_at) DESC`
      )
      return result.rows.map(mapRowToStreamWithPreview)
    }

    if (types && types.length > 0) {
      const result = await db.query<StreamWithPreviewRow>(
        sql`${sql.raw(SELECT_WITH_PREVIEW)}
            WHERE s.workspace_id = ${workspaceId}
              AND s.type = ANY(${types})
              AND (${filterAll} OR (${includeArchived} AND s.archived_at IS NOT NULL) OR (${!includeArchived} AND s.archived_at IS NULL))
            ORDER BY COALESCE(lm.created_at, s.created_at) DESC`
      )
      return result.rows.map(mapRowToStreamWithPreview)
    }

    const result = await db.query<StreamWithPreviewRow>(
      sql`${sql.raw(SELECT_WITH_PREVIEW)}
          WHERE s.workspace_id = ${workspaceId}
            AND (${filterAll} OR (${includeArchived} AND s.archived_at IS NOT NULL) OR (${!includeArchived} AND s.archived_at IS NULL))
          ORDER BY COALESCE(lm.created_at, s.created_at) DESC`
    )
    return result.rows.map(mapRowToStreamWithPreview)
  },

  async insert(db: Querier, params: InsertStreamParams): Promise<Stream> {
    const result = await db.query<StreamRow>(sql`
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
  async insertThreadOrFind(db: Querier, params: InsertStreamParams): Promise<{ stream: Stream; created: boolean }> {
    // Try to insert with ON CONFLICT DO NOTHING
    const insertResult = await db.query<StreamRow>(sql`
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
    const existing = await this.findByParentMessage(db, params.parentStreamId!, params.parentMessageId!)
    if (!existing) {
      // This shouldn't happen - if ON CONFLICT triggered, the row exists
      throw new Error("Thread creation conflict but existing thread not found")
    }
    return { stream: existing, created: false }
  },

  async update(db: Querier, id: string, params: UpdateStreamParams): Promise<Stream | null> {
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

    if (sets.length === 0) return this.findById(db, id)

    sets.push(`updated_at = NOW()`)
    values.push(id)

    const query = `
      UPDATE streams SET ${sets.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING ${SELECT_FIELDS}
    `
    const result = await db.query<StreamRow>(query, values)
    return result.rows[0] ? mapRowToStream(result.rows[0]) : null
  },

  async slugExistsInWorkspace(db: Querier, workspaceId: string, slug: string): Promise<boolean> {
    const result = await db.query(sql`
      SELECT 1 FROM streams
      WHERE workspace_id = ${workspaceId} AND slug = ${slug}
    `)
    return result.rows.length > 0
  },

  /**
   * Atomically insert a system stream or return the existing one.
   * Uses ON CONFLICT DO NOTHING on idx_streams_system_per_member to handle
   * concurrent provisioning (same pattern as insertOrFindThread).
   */
  async insertSystemStream(
    db: Querier,
    params: { id: string; workspaceId: string; createdBy: string }
  ): Promise<{ stream: Stream; created: boolean }> {
    const insertResult = await db.query<StreamRow>(sql`
      INSERT INTO streams (
        id, workspace_id, type, display_name, visibility,
        companion_mode, created_by
      ) VALUES (
        ${params.id},
        ${params.workspaceId},
        ${"system"},
        ${"System"},
        ${"private"},
        ${"off"},
        ${params.createdBy}
      )
      ON CONFLICT (workspace_id, created_by) WHERE type = 'system'
      DO NOTHING
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)

    if (insertResult.rows.length > 0) {
      return { stream: mapRowToStream(insertResult.rows[0]), created: true }
    }

    const existing = await this.findByTypeAndOwner(db, params.workspaceId, "system", params.createdBy)
    if (!existing) {
      throw new Error("System stream creation conflict but existing stream not found")
    }
    return { stream: existing, created: false }
  },

  async findByTypeAndOwner(
    db: Querier,
    workspaceId: string,
    type: StreamType,
    createdBy: string
  ): Promise<Stream | null> {
    const result = await db.query<StreamRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
      WHERE workspace_id = ${workspaceId} AND type = ${type} AND created_by = ${createdBy}
      LIMIT 1
    `)
    return result.rows[0] ? mapRowToStream(result.rows[0]) : null
  },

  async findByParentMessage(db: Querier, parentStreamId: string, parentMessageId: string): Promise<Stream | null> {
    const result = await db.query<StreamRow>(sql`
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
  async findThreadsForMessages(db: Querier, parentStreamId: string): Promise<Map<string, string>> {
    const result = await db.query<{ parent_message_id: string; id: string }>(sql`
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
    db: Querier,
    parentStreamId: string
  ): Promise<Map<string, { threadId: string; replyCount: number }>> {
    const result = await db.query<{ parent_message_id: string; id: string; reply_count: string }>(sql`
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

  /**
   * Search for streams by display name or slug.
   * Uses pg_trgm trigram similarity for fuzzy matching (handles typos),
   * combined with ILIKE for exact substring matches.
   * Only searches within the provided stream IDs (for access control).
   */
  async searchByName(
    db: Querier,
    params: {
      streamIds: string[]
      query: string
      types?: StreamType[]
      limit?: number
    }
  ): Promise<Stream[]> {
    const { streamIds, query, types, limit = 10 } = params
    if (streamIds.length === 0) return []

    const pattern = `%${query}%`

    // Use separate queries for type-filtered vs unfiltered to avoid nested sql fragments
    if (types && types.length > 0) {
      const result = await db.query<StreamRow>(sql`
        SELECT ${sql.raw(SELECT_FIELDS)},
          GREATEST(
            COALESCE(similarity(display_name, ${query}), 0),
            COALESCE(similarity(slug, ${query}), 0)
          ) AS sim_score
        FROM streams
        WHERE id = ANY(${streamIds})
          AND type = ANY(${types})
          AND (
            display_name % ${query}
            OR slug % ${query}
            OR display_name ILIKE ${pattern}
            OR slug ILIKE ${pattern}
          )
        ORDER BY sim_score DESC, display_name NULLS LAST
        LIMIT ${limit}
      `)
      return result.rows.map(mapRowToStream)
    }

    const result = await db.query<StreamRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)},
        GREATEST(
          COALESCE(similarity(display_name, ${query}), 0),
          COALESCE(similarity(slug, ${query}), 0)
        ) AS sim_score
      FROM streams
      WHERE id = ANY(${streamIds})
        AND (
          display_name % ${query}
          OR slug % ${query}
          OR display_name ILIKE ${pattern}
          OR slug ILIKE ${pattern}
        )
      ORDER BY sim_score DESC, display_name NULLS LAST
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToStream)
  },
}
