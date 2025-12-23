import { PoolClient } from "pg"
import { sql } from "../db"
import type { ConversationStatus } from "@threa/types"

interface ConversationRow {
  id: string
  stream_id: string
  workspace_id: string
  message_ids: string[]
  participant_ids: string[]
  topic_summary: string | null
  completeness_score: number
  status: string
  parent_conversation_id: string | null
  last_activity_at: Date
  created_at: Date
  updated_at: Date
}

export interface Conversation {
  id: string
  streamId: string
  workspaceId: string
  messageIds: string[]
  participantIds: string[]
  topicSummary: string | null
  completenessScore: number
  status: ConversationStatus
  parentConversationId: string | null
  lastActivityAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface InsertConversationParams {
  id: string
  streamId: string
  workspaceId: string
  messageIds?: string[]
  participantIds?: string[]
  topicSummary?: string
  completenessScore?: number
  status?: ConversationStatus
  parentConversationId?: string
}

export interface UpdateConversationParams {
  messageIds?: string[]
  participantIds?: string[]
  topicSummary?: string
  completenessScore?: number
  status?: ConversationStatus
  lastActivityAt?: Date
}

function mapRowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    streamId: row.stream_id,
    workspaceId: row.workspace_id,
    messageIds: row.message_ids,
    participantIds: row.participant_ids,
    topicSummary: row.topic_summary,
    completenessScore: row.completeness_score,
    status: row.status as ConversationStatus,
    parentConversationId: row.parent_conversation_id,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT_FIELDS = `
  id, stream_id, workspace_id, message_ids, participant_ids,
  topic_summary, completeness_score, status, parent_conversation_id,
  last_activity_at, created_at, updated_at
`

export const ConversationRepository = {
  async findById(client: PoolClient, id: string): Promise<Conversation | null> {
    const result = await client.query<ConversationRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM conversations WHERE id = ${id}`
    )
    if (!result.rows[0]) return null
    return mapRowToConversation(result.rows[0])
  },

  async findByStream(
    client: PoolClient,
    streamId: string,
    options?: { status?: ConversationStatus; limit?: number }
  ): Promise<Conversation[]> {
    const limit = options?.limit ?? 50

    if (options?.status) {
      const result = await client.query<ConversationRow>(sql`
        SELECT ${sql.raw(SELECT_FIELDS)} FROM conversations
        WHERE stream_id = ${streamId} AND status = ${options.status}
        ORDER BY last_activity_at DESC
        LIMIT ${limit}
      `)
      return result.rows.map(mapRowToConversation)
    }

    const result = await client.query<ConversationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM conversations
      WHERE stream_id = ${streamId}
      ORDER BY last_activity_at DESC
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToConversation)
  },

  async findActiveByStream(client: PoolClient, streamId: string): Promise<Conversation[]> {
    const result = await client.query<ConversationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM conversations
      WHERE stream_id = ${streamId} AND status = 'active'
      ORDER BY last_activity_at DESC
    `)
    return result.rows.map(mapRowToConversation)
  },

  async findByMessageId(client: PoolClient, messageId: string): Promise<Conversation[]> {
    const result = await client.query<ConversationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM conversations
      WHERE ${messageId} = ANY(message_ids)
      ORDER BY last_activity_at DESC
    `)
    return result.rows.map(mapRowToConversation)
  },

  async findByWorkspace(
    client: PoolClient,
    workspaceId: string,
    options?: { status?: ConversationStatus; limit?: number }
  ): Promise<Conversation[]> {
    const limit = options?.limit ?? 50

    if (options?.status) {
      const result = await client.query<ConversationRow>(sql`
        SELECT ${sql.raw(SELECT_FIELDS)} FROM conversations
        WHERE workspace_id = ${workspaceId} AND status = ${options.status}
        ORDER BY last_activity_at DESC
        LIMIT ${limit}
      `)
      return result.rows.map(mapRowToConversation)
    }

    const result = await client.query<ConversationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM conversations
      WHERE workspace_id = ${workspaceId}
      ORDER BY last_activity_at DESC
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToConversation)
  },

  async insert(client: PoolClient, params: InsertConversationParams): Promise<Conversation> {
    const result = await client.query<ConversationRow>(sql`
      INSERT INTO conversations (
        id, stream_id, workspace_id, message_ids, participant_ids,
        topic_summary, completeness_score, status, parent_conversation_id
      )
      VALUES (
        ${params.id},
        ${params.streamId},
        ${params.workspaceId},
        ${params.messageIds ?? []},
        ${params.participantIds ?? []},
        ${params.topicSummary ?? null},
        ${params.completenessScore ?? 1},
        ${params.status ?? "active"},
        ${params.parentConversationId ?? null}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRowToConversation(result.rows[0])
  },

  async update(client: PoolClient, id: string, params: UpdateConversationParams): Promise<Conversation | null> {
    const updates: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (params.messageIds !== undefined) {
      updates.push(`message_ids = $${paramIndex++}`)
      values.push(params.messageIds)
    }
    if (params.participantIds !== undefined) {
      updates.push(`participant_ids = $${paramIndex++}`)
      values.push(params.participantIds)
    }
    if (params.topicSummary !== undefined) {
      updates.push(`topic_summary = $${paramIndex++}`)
      values.push(params.topicSummary)
    }
    if (params.completenessScore !== undefined) {
      updates.push(`completeness_score = $${paramIndex++}`)
      values.push(params.completenessScore)
    }
    if (params.status !== undefined) {
      updates.push(`status = $${paramIndex++}`)
      values.push(params.status)
    }
    if (params.lastActivityAt !== undefined) {
      updates.push(`last_activity_at = $${paramIndex++}`)
      values.push(params.lastActivityAt)
    }

    if (updates.length === 0) {
      return this.findById(client, id)
    }

    updates.push(`updated_at = NOW()`)
    values.push(id)

    const query = `
      UPDATE conversations
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING ${SELECT_FIELDS}
    `

    const result = await client.query<ConversationRow>(query, values)
    if (!result.rows[0]) return null
    return mapRowToConversation(result.rows[0])
  },

  async addMessage(client: PoolClient, id: string, messageId: string): Promise<Conversation | null> {
    const result = await client.query<ConversationRow>(sql`
      UPDATE conversations
      SET message_ids = array_append(message_ids, ${messageId}),
          last_activity_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    if (!result.rows[0]) return null
    return mapRowToConversation(result.rows[0])
  },

  async addParticipant(client: PoolClient, id: string, participantId: string): Promise<Conversation | null> {
    const result = await client.query<ConversationRow>(sql`
      UPDATE conversations
      SET participant_ids = CASE
            WHEN ${participantId} = ANY(participant_ids) THEN participant_ids
            ELSE array_append(participant_ids, ${participantId})
          END,
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    if (!result.rows[0]) return null
    return mapRowToConversation(result.rows[0])
  },

  async delete(client: PoolClient, id: string): Promise<boolean> {
    const result = await client.query(sql`DELETE FROM conversations WHERE id = ${id}`)
    return result.rowCount !== null && result.rowCount > 0
  },
}
