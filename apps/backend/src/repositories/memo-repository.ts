import { PoolClient } from "pg"
import { sql } from "../db"
import type { MemoType, KnowledgeType, MemoStatus } from "@threa/types"

interface MemoRow {
  id: string
  workspace_id: string
  memo_type: string
  source_message_id: string | null
  source_conversation_id: string | null
  title: string
  abstract: string
  key_points: string[]
  source_message_ids: string[]
  participant_ids: string[]
  knowledge_type: string
  tags: string[]
  parent_memo_id: string | null
  status: string
  version: number
  revision_reason: string | null
  created_at: Date
  updated_at: Date
  archived_at: Date | null
}

export interface Memo {
  id: string
  workspaceId: string
  memoType: MemoType
  sourceMessageId: string | null
  sourceConversationId: string | null
  title: string
  abstract: string
  keyPoints: string[]
  sourceMessageIds: string[]
  participantIds: string[]
  knowledgeType: KnowledgeType
  tags: string[]
  parentMemoId: string | null
  status: MemoStatus
  version: number
  revisionReason: string | null
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
}

export interface InsertMemoParams {
  id: string
  workspaceId: string
  memoType: MemoType
  sourceMessageId?: string
  sourceConversationId?: string
  title: string
  abstract: string
  keyPoints?: string[]
  sourceMessageIds: string[]
  participantIds: string[]
  knowledgeType: KnowledgeType
  tags?: string[]
  parentMemoId?: string
  status?: MemoStatus
  version?: number
}

export interface UpdateMemoParams {
  title?: string
  abstract?: string
  keyPoints?: string[]
  sourceMessageIds?: string[]
  participantIds?: string[]
  knowledgeType?: KnowledgeType
  tags?: string[]
  parentMemoId?: string
  status?: MemoStatus
  version?: number
  revisionReason?: string
}

/**
 * Result from semantic memo search, including source stream info.
 */
export interface MemoSearchResult {
  memo: Memo
  distance: number
  sourceStream: {
    id: string
    type: string
    name: string | null
  } | null
}

export interface SemanticSearchParams {
  workspaceId: string
  embedding: number[]
  streamIds?: string[]
  limit?: number
  threshold?: number
}

export interface FullTextSearchParams {
  workspaceId: string
  query: string
  streamIds?: string[]
  limit?: number
}

function mapRowToMemo(row: MemoRow): Memo {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    memoType: row.memo_type as MemoType,
    sourceMessageId: row.source_message_id,
    sourceConversationId: row.source_conversation_id,
    title: row.title,
    abstract: row.abstract,
    keyPoints: row.key_points,
    sourceMessageIds: row.source_message_ids,
    participantIds: row.participant_ids,
    knowledgeType: row.knowledge_type as KnowledgeType,
    tags: row.tags,
    parentMemoId: row.parent_memo_id,
    status: row.status as MemoStatus,
    version: row.version,
    revisionReason: row.revision_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }
}

const SELECT_FIELDS = `
  id, workspace_id, memo_type, source_message_id, source_conversation_id,
  title, abstract, key_points, source_message_ids, participant_ids,
  knowledge_type, tags, parent_memo_id, status, version, revision_reason,
  created_at, updated_at, archived_at
`

const SELECT_FIELDS_PREFIXED = `
  m.id, m.workspace_id, m.memo_type, m.source_message_id, m.source_conversation_id,
  m.title, m.abstract, m.key_points, m.source_message_ids, m.participant_ids,
  m.knowledge_type, m.tags, m.parent_memo_id, m.status, m.version, m.revision_reason,
  m.created_at, m.updated_at, m.archived_at
`

export const MemoRepository = {
  async findById(client: PoolClient, id: string): Promise<Memo | null> {
    const result = await client.query<MemoRow>(sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM memos WHERE id = ${id}`)
    if (!result.rows[0]) return null
    return mapRowToMemo(result.rows[0])
  },

  async findByWorkspace(
    client: PoolClient,
    workspaceId: string,
    options?: { status?: MemoStatus; type?: MemoType; limit?: number }
  ): Promise<Memo[]> {
    const limit = options?.limit ?? 50
    const conditions: string[] = [`workspace_id = $1`]
    const values: unknown[] = [workspaceId]
    let paramIndex = 2

    if (options?.status) {
      conditions.push(`status = $${paramIndex++}`)
      values.push(options.status)
    }
    if (options?.type) {
      conditions.push(`memo_type = $${paramIndex++}`)
      values.push(options.type)
    }

    values.push(limit)

    const query = `
      SELECT ${SELECT_FIELDS} FROM memos
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}
    `

    const result = await client.query<MemoRow>(query, values)
    return result.rows.map(mapRowToMemo)
  },

  async findByStream(
    client: PoolClient,
    streamId: string,
    options?: { status?: MemoStatus; limit?: number; orderBy?: "createdAt" | "updatedAt" }
  ): Promise<Memo[]> {
    const limit = options?.limit ?? 50
    const orderBy = options?.orderBy === "updatedAt" ? "updated_at" : "created_at"

    // Use UNION to fetch both:
    // 1. Conversation memos (via source_conversation_id -> conversations.stream_id)
    // 2. Message memos (via source_message_id -> messages.stream_id)
    // Status filter is optional - when provided, filter both branches with parameterized values
    const values: unknown[] = [streamId]
    let paramIndex = 2
    let statusClause = ""

    if (options?.status) {
      // Use parameterized query to prevent SQL injection
      statusClause = `AND m.status = $${paramIndex}`
      values.push(options.status)
      paramIndex++
    }

    values.push(limit)

    const query = `
      SELECT ${SELECT_FIELDS_PREFIXED} FROM memos m
      JOIN conversations c ON m.source_conversation_id = c.id
      WHERE c.stream_id = $1 ${statusClause}
      UNION
      SELECT ${SELECT_FIELDS_PREFIXED} FROM memos m
      JOIN messages msg ON m.source_message_id = msg.id
      WHERE msg.stream_id = $1 ${statusClause}
      ORDER BY ${orderBy} DESC
      LIMIT $${paramIndex}
    `

    const result = await client.query<MemoRow>(query, values)
    return result.rows.map(mapRowToMemo)
  },

  async findBySourceMessage(client: PoolClient, messageId: string): Promise<Memo | null> {
    const result = await client.query<MemoRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM memos
      WHERE source_message_id = ${messageId}
    `)
    if (!result.rows[0]) return null
    return mapRowToMemo(result.rows[0])
  },

  async findBySourceConversation(client: PoolClient, conversationId: string): Promise<Memo[]> {
    const result = await client.query<MemoRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM memos
      WHERE source_conversation_id = ${conversationId}
      ORDER BY version DESC
    `)
    return result.rows.map(mapRowToMemo)
  },

  async findActiveByConversation(client: PoolClient, conversationId: string): Promise<Memo | null> {
    const result = await client.query<MemoRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM memos
      WHERE source_conversation_id = ${conversationId} AND status = 'active'
      ORDER BY version DESC
      LIMIT 1
    `)
    if (!result.rows[0]) return null
    return mapRowToMemo(result.rows[0])
  },

  async insert(client: PoolClient, params: InsertMemoParams): Promise<Memo> {
    const result = await client.query<MemoRow>(sql`
      INSERT INTO memos (
        id, workspace_id, memo_type, source_message_id, source_conversation_id,
        title, abstract, key_points, source_message_ids, participant_ids,
        knowledge_type, tags, parent_memo_id, status, version
      )
      VALUES (
        ${params.id},
        ${params.workspaceId},
        ${params.memoType},
        ${params.sourceMessageId ?? null},
        ${params.sourceConversationId ?? null},
        ${params.title},
        ${params.abstract},
        ${params.keyPoints ?? []},
        ${params.sourceMessageIds},
        ${params.participantIds},
        ${params.knowledgeType},
        ${params.tags ?? []},
        ${params.parentMemoId ?? null},
        ${params.status ?? "active"},
        ${params.version ?? 1}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRowToMemo(result.rows[0])
  },

  async update(client: PoolClient, id: string, params: UpdateMemoParams): Promise<Memo | null> {
    const updates: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (params.title !== undefined) {
      updates.push(`title = $${paramIndex++}`)
      values.push(params.title)
    }
    if (params.abstract !== undefined) {
      updates.push(`abstract = $${paramIndex++}`)
      values.push(params.abstract)
    }
    if (params.keyPoints !== undefined) {
      updates.push(`key_points = $${paramIndex++}`)
      values.push(params.keyPoints)
    }
    if (params.sourceMessageIds !== undefined) {
      updates.push(`source_message_ids = $${paramIndex++}`)
      values.push(params.sourceMessageIds)
    }
    if (params.participantIds !== undefined) {
      updates.push(`participant_ids = $${paramIndex++}`)
      values.push(params.participantIds)
    }
    if (params.knowledgeType !== undefined) {
      updates.push(`knowledge_type = $${paramIndex++}`)
      values.push(params.knowledgeType)
    }
    if (params.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`)
      values.push(params.tags)
    }
    if (params.parentMemoId !== undefined) {
      updates.push(`parent_memo_id = $${paramIndex++}`)
      values.push(params.parentMemoId)
    }
    if (params.status !== undefined) {
      updates.push(`status = $${paramIndex++}`)
      values.push(params.status)
    }
    if (params.version !== undefined) {
      updates.push(`version = $${paramIndex++}`)
      values.push(params.version)
    }
    if (params.revisionReason !== undefined) {
      updates.push(`revision_reason = $${paramIndex++}`)
      values.push(params.revisionReason)
    }

    if (updates.length === 0) {
      return this.findById(client, id)
    }

    updates.push(`updated_at = NOW()`)
    values.push(id)

    const query = `
      UPDATE memos
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING ${SELECT_FIELDS}
    `

    const result = await client.query<MemoRow>(query, values)
    if (!result.rows[0]) return null
    return mapRowToMemo(result.rows[0])
  },

  async updateEmbedding(client: PoolClient, id: string, embedding: number[]): Promise<void> {
    await client.query(sql`
      UPDATE memos
      SET embedding = ${JSON.stringify(embedding)}::vector,
          updated_at = NOW()
      WHERE id = ${id}
    `)
  },

  async supersede(client: PoolClient, id: string, reason: string): Promise<Memo | null> {
    const result = await client.query<MemoRow>(sql`
      UPDATE memos
      SET status = 'superseded',
          revision_reason = ${reason},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    if (!result.rows[0]) return null
    return mapRowToMemo(result.rows[0])
  },

  async archive(client: PoolClient, id: string): Promise<Memo | null> {
    const result = await client.query<MemoRow>(sql`
      UPDATE memos
      SET status = 'archived',
          archived_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    if (!result.rows[0]) return null
    return mapRowToMemo(result.rows[0])
  },

  async getAllTags(client: PoolClient, workspaceId: string): Promise<string[]> {
    const result = await client.query<{ tag: string }>(sql`
      SELECT DISTINCT unnest(tags) as tag
      FROM memos
      WHERE workspace_id = ${workspaceId} AND status = 'active'
      ORDER BY tag
    `)
    return result.rows.map((r) => r.tag)
  },

  /**
   * Semantic search over memo abstracts using vector similarity.
   *
   * Finds memos whose abstract embedding is similar to the query embedding.
   * Optionally filters to memos linked to specific streams.
   * Returns memos with their source stream info for navigation.
   */
  async semanticSearch(client: PoolClient, params: SemanticSearchParams): Promise<MemoSearchResult[]> {
    const { workspaceId, embedding, streamIds, limit = 10, threshold = 0.8 } = params
    const hasStreamFilter = streamIds && streamIds.length > 0

    const embeddingLiteral = `[${embedding.join(",")}]`

    interface SearchResultRow extends MemoRow {
      distance: number
      stream_id: string | null
      stream_type: string | null
      stream_name: string | null
    }

    // Join through either source_message_id or source_conversation_id to get stream info
    const result = await client.query<SearchResultRow>(sql`
      WITH memo_with_stream AS (
        SELECT
          ${sql.raw(SELECT_FIELDS_PREFIXED)},
          m.embedding <=> ${embeddingLiteral}::vector as distance,
          COALESCE(msg_stream.id, conv_stream.id) as stream_id,
          COALESCE(msg_stream.type, conv_stream.type) as stream_type,
          COALESCE(msg_stream.display_name, conv_stream.display_name) as stream_name
        FROM memos m
        LEFT JOIN messages msg ON m.source_message_id = msg.id
        LEFT JOIN streams msg_stream ON msg.stream_id = msg_stream.id
        LEFT JOIN conversations conv ON m.source_conversation_id = conv.id
        LEFT JOIN streams conv_stream ON conv.stream_id = conv_stream.id
        WHERE m.workspace_id = ${workspaceId}
          AND m.status = 'active'
          AND m.embedding IS NOT NULL
          AND m.embedding <=> ${embeddingLiteral}::vector < ${threshold}
      )
      SELECT * FROM memo_with_stream
      WHERE (${!hasStreamFilter} OR stream_id = ANY(${streamIds ?? []}))
      ORDER BY distance ASC
      LIMIT ${limit}
    `)

    return result.rows.map((row) => ({
      memo: mapRowToMemo(row),
      distance: row.distance,
      sourceStream: row.stream_id
        ? {
            id: row.stream_id,
            type: row.stream_type!,
            name: row.stream_name,
          }
        : null,
    }))
  },

  /**
   * Full-text search over memo title, abstract, and key points.
   *
   * Uses PostgreSQL full-text search for exact phrase matching.
   * Optionally filters to memos linked to specific streams.
   * Returns memos with their source stream info for navigation.
   */
  async fullTextSearch(client: PoolClient, params: FullTextSearchParams): Promise<MemoSearchResult[]> {
    const { workspaceId, query, streamIds, limit = 10 } = params
    const hasStreamFilter = streamIds && streamIds.length > 0

    interface SearchResultRow extends MemoRow {
      rank: number
      stream_id: string | null
      stream_type: string | null
      stream_name: string | null
    }

    // Convert query to tsquery - plainto_tsquery handles most cases,
    // but we use websearch_to_tsquery for phrase support
    const result = await client.query<SearchResultRow>(sql`
      WITH memo_with_stream AS (
        SELECT
          ${sql.raw(SELECT_FIELDS_PREFIXED)},
          ts_rank(
            to_tsvector('english', m.title || ' ' || m.abstract || ' ' || array_to_string(m.key_points, ' ')),
            websearch_to_tsquery('english', ${query})
          ) as rank,
          COALESCE(msg_stream.id, conv_stream.id) as stream_id,
          COALESCE(msg_stream.type, conv_stream.type) as stream_type,
          COALESCE(msg_stream.display_name, conv_stream.display_name) as stream_name
        FROM memos m
        LEFT JOIN messages msg ON m.source_message_id = msg.id
        LEFT JOIN streams msg_stream ON msg.stream_id = msg_stream.id
        LEFT JOIN conversations conv ON m.source_conversation_id = conv.id
        LEFT JOIN streams conv_stream ON conv.stream_id = conv_stream.id
        WHERE m.workspace_id = ${workspaceId}
          AND m.status = 'active'
          AND to_tsvector('english', m.title || ' ' || m.abstract || ' ' || array_to_string(m.key_points, ' '))
              @@ websearch_to_tsquery('english', ${query})
      )
      SELECT * FROM memo_with_stream
      WHERE (${!hasStreamFilter} OR stream_id = ANY(${streamIds ?? []}))
      ORDER BY rank DESC
      LIMIT ${limit}
    `)

    return result.rows.map((row) => ({
      memo: mapRowToMemo(row),
      distance: 1 - row.rank, // Convert rank to distance (lower = better match)
      sourceStream: row.stream_id
        ? {
            id: row.stream_id,
            type: row.stream_type!,
            name: row.stream_name,
          }
        : null,
    }))
  },
}
