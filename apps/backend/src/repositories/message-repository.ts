import { PoolClient } from "pg"
import { sql } from "../db"

// Internal row type (snake_case, not exported)
interface MessageRow {
  id: string
  stream_id: string
  sequence: string
  author_id: string
  author_type: string
  content: string
  content_format: string
  reply_count: number
  edited_at: Date | null
  deleted_at: Date | null
  created_at: Date
}

interface ReactionRow {
  message_id: string
  user_id: string
  emoji: string
}

// Domain type (camelCase, exported)
export interface Message {
  id: string
  streamId: string
  sequence: bigint
  authorId: string
  authorType: "user" | "persona"
  content: string
  contentFormat: "markdown" | "plaintext"
  replyCount: number
  reactions: Record<string, string[]>
  editedAt: Date | null
  deletedAt: Date | null
  createdAt: Date
}

export interface InsertMessageParams {
  id: string
  streamId: string
  sequence: bigint
  authorId: string
  authorType: "user" | "persona"
  content: string
  contentFormat?: "markdown" | "plaintext"
}

function mapRowToMessage(row: MessageRow, reactions: Record<string, string[]> = {}): Message {
  return {
    id: row.id,
    streamId: row.stream_id,
    sequence: BigInt(row.sequence),
    authorId: row.author_id,
    authorType: row.author_type as "user" | "persona",
    content: row.content,
    contentFormat: row.content_format as "markdown" | "plaintext",
    replyCount: row.reply_count,
    reactions,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
  }
}

function aggregateReactions(rows: ReactionRow[]): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const row of rows) {
    if (!result[row.emoji]) {
      result[row.emoji] = []
    }
    result[row.emoji].push(row.user_id)
  }
  // Filter out empty arrays (shouldn't happen, but defensive)
  for (const emoji of Object.keys(result)) {
    if (result[emoji].length === 0) {
      delete result[emoji]
    }
  }
  return result
}

function aggregateReactionsByMessage(rows: ReactionRow[]): Map<string, Record<string, string[]>> {
  const byMessage = new Map<string, ReactionRow[]>()
  for (const row of rows) {
    const existing = byMessage.get(row.message_id) ?? []
    existing.push(row)
    byMessage.set(row.message_id, existing)
  }

  const result = new Map<string, Record<string, string[]>>()
  for (const [messageId, reactions] of byMessage) {
    result.set(messageId, aggregateReactions(reactions))
  }
  return result
}

const SELECT_FIELDS = `
  id, stream_id, sequence, author_id, author_type,
  content, content_format, reply_count,
  edited_at, deleted_at, created_at
`

export const MessageRepository = {
  async findById(client: PoolClient, id: string): Promise<Message | null> {
    const result = await client.query<MessageRow>(sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM messages WHERE id = ${id}`)
    if (!result.rows[0]) return null

    const reactionsResult = await client.query<ReactionRow>(
      sql`SELECT message_id, user_id, emoji FROM reactions WHERE message_id = ${id}`
    )
    const reactions = aggregateReactions(reactionsResult.rows)

    return mapRowToMessage(result.rows[0], reactions)
  },

  async findByIds(client: PoolClient, ids: string[]): Promise<Map<string, Message>> {
    if (ids.length === 0) return new Map()

    const result = await client.query<MessageRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM messages
      WHERE id = ANY(${ids})
    `)

    if (result.rows.length === 0) return new Map()

    const reactionsResult = await client.query<ReactionRow>(sql`
      SELECT message_id, user_id, emoji FROM reactions
      WHERE message_id = ANY(${ids})
    `)
    const reactionsByMessage = aggregateReactionsByMessage(reactionsResult.rows)

    const map = new Map<string, Message>()
    for (const row of result.rows) {
      map.set(row.id, mapRowToMessage(row, reactionsByMessage.get(row.id) ?? {}))
    }
    return map
  },

  async list(
    client: PoolClient,
    streamId: string,
    filters?: { limit?: number; beforeSequence?: bigint }
  ): Promise<Message[]> {
    const limit = filters?.limit ?? 50

    let messageRows: MessageRow[]
    if (filters?.beforeSequence) {
      const result = await client.query<MessageRow>(sql`
        SELECT ${sql.raw(SELECT_FIELDS)} FROM messages
        WHERE stream_id = ${streamId}
          AND sequence < ${filters.beforeSequence.toString()}
          AND deleted_at IS NULL
        ORDER BY sequence DESC
        LIMIT ${limit}
      `)
      messageRows = result.rows
    } else {
      const result = await client.query<MessageRow>(sql`
        SELECT ${sql.raw(SELECT_FIELDS)} FROM messages
        WHERE stream_id = ${streamId}
          AND deleted_at IS NULL
        ORDER BY sequence DESC
        LIMIT ${limit}
      `)
      messageRows = result.rows
    }

    if (messageRows.length === 0) return []

    const messageIds = messageRows.map((r) => r.id)
    const reactionsResult = await client.query<ReactionRow>(sql`
      SELECT message_id, user_id, emoji FROM reactions
      WHERE message_id = ANY(${messageIds})
    `)
    const reactionsByMessage = aggregateReactionsByMessage(reactionsResult.rows)

    return messageRows.map((row) => mapRowToMessage(row, reactionsByMessage.get(row.id) ?? {})).reverse()
  },

  async insert(client: PoolClient, params: InsertMessageParams): Promise<Message> {
    const result = await client.query<MessageRow>(sql`
      INSERT INTO messages (id, stream_id, sequence, author_id, author_type, content, content_format)
      VALUES (
        ${params.id},
        ${params.streamId},
        ${params.sequence.toString()},
        ${params.authorId},
        ${params.authorType},
        ${params.content},
        ${params.contentFormat ?? "markdown"}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRowToMessage(result.rows[0])
  },

  async updateContent(client: PoolClient, id: string, content: string): Promise<Message | null> {
    const result = await client.query<MessageRow>(sql`
      UPDATE messages
      SET content = ${content}, edited_at = NOW()
      WHERE id = ${id}
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    if (!result.rows[0]) return null
    return this.findById(client, id)
  },

  async softDelete(client: PoolClient, id: string): Promise<Message | null> {
    const result = await client.query<MessageRow>(sql`
      UPDATE messages
      SET deleted_at = NOW()
      WHERE id = ${id}
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    if (!result.rows[0]) return null
    return this.findById(client, id)
  },

  async addReaction(client: PoolClient, messageId: string, emoji: string, userId: string): Promise<Message | null> {
    // Insert into reactions table (ON CONFLICT DO NOTHING handles duplicates)
    await client.query(sql`
      INSERT INTO reactions (message_id, user_id, emoji)
      VALUES (${messageId}, ${userId}, ${emoji})
      ON CONFLICT DO NOTHING
    `)
    return this.findById(client, messageId)
  },

  async removeReaction(client: PoolClient, messageId: string, emoji: string, userId: string): Promise<Message | null> {
    await client.query(sql`
      DELETE FROM reactions
      WHERE message_id = ${messageId}
        AND user_id = ${userId}
        AND emoji = ${emoji}
    `)
    return this.findById(client, messageId)
  },

  async incrementReplyCount(client: PoolClient, id: string): Promise<void> {
    await client.query(sql`
      UPDATE messages
      SET reply_count = reply_count + 1
      WHERE id = ${id}
    `)
  },

  async decrementReplyCount(client: PoolClient, id: string): Promise<void> {
    await client.query(sql`
      UPDATE messages
      SET reply_count = GREATEST(reply_count - 1, 0)
      WHERE id = ${id}
    `)
  },

  /**
   * Get reply counts for multiple messages.
   * Returns a map of messageId -> replyCount
   */
  async getReplyCountsBatch(client: PoolClient, messageIds: string[]): Promise<Map<string, number>> {
    if (messageIds.length === 0) return new Map()

    const result = await client.query<{ id: string; reply_count: number }>(sql`
      SELECT id, reply_count FROM messages
      WHERE id = ANY(${messageIds})
    `)

    const map = new Map<string, number>()
    for (const row of result.rows) {
      map.set(row.id, row.reply_count)
    }
    return map
  },

  /**
   * Update the embedding for a message.
   * Used by the embedding worker after generating embeddings.
   */
  async updateEmbedding(client: PoolClient, id: string, embedding: number[]): Promise<void> {
    const embeddingLiteral = `[${embedding.join(",")}]`
    await client.query(sql`
      UPDATE messages
      SET embedding = ${embeddingLiteral}::vector
      WHERE id = ${id}
    `)
  },

  /**
   * List messages since a given sequence number.
   * Used by agents to check for new messages during their loop.
   */
  async listSince(
    client: PoolClient,
    streamId: string,
    sinceSequence: bigint,
    options?: { excludeAuthorId?: string; limit?: number }
  ): Promise<Message[]> {
    const limit = options?.limit ?? 50
    const excludeAuthorId = options?.excludeAuthorId

    let messageRows: MessageRow[]
    if (excludeAuthorId) {
      const result = await client.query<MessageRow>(sql`
        SELECT ${sql.raw(SELECT_FIELDS)} FROM messages
        WHERE stream_id = ${streamId}
          AND sequence > ${sinceSequence.toString()}
          AND author_id != ${excludeAuthorId}
          AND deleted_at IS NULL
        ORDER BY sequence ASC
        LIMIT ${limit}
      `)
      messageRows = result.rows
    } else {
      const result = await client.query<MessageRow>(sql`
        SELECT ${sql.raw(SELECT_FIELDS)} FROM messages
        WHERE stream_id = ${streamId}
          AND sequence > ${sinceSequence.toString()}
          AND deleted_at IS NULL
        ORDER BY sequence ASC
        LIMIT ${limit}
      `)
      messageRows = result.rows
    }

    if (messageRows.length === 0) return []

    const messageIds = messageRows.map((r) => r.id)
    const reactionsResult = await client.query<ReactionRow>(sql`
      SELECT message_id, user_id, emoji FROM reactions
      WHERE message_id = ANY(${messageIds})
    `)
    const reactionsByMessage = aggregateReactionsByMessage(reactionsResult.rows)

    return messageRows.map((row) => mapRowToMessage(row, reactionsByMessage.get(row.id) ?? {}))
  },
}
