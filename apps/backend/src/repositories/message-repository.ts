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
  reactions: Record<string, string[]>
  edited_at: Date | null
  deleted_at: Date | null
  created_at: Date
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

function mapRowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    streamId: row.stream_id,
    sequence: BigInt(row.sequence),
    authorId: row.author_id,
    authorType: row.author_type as "user" | "persona",
    content: row.content,
    contentFormat: row.content_format as "markdown" | "plaintext",
    replyCount: row.reply_count,
    reactions: row.reactions,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
  }
}

const SELECT_FIELDS = `
  id, stream_id, sequence, author_id, author_type,
  content, content_format, reply_count, reactions,
  edited_at, deleted_at, created_at
`

export const MessageRepository = {
  async findById(client: PoolClient, id: string): Promise<Message | null> {
    const result = await client.query<MessageRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM messages WHERE id = ${id}`,
    )
    return result.rows[0] ? mapRowToMessage(result.rows[0]) : null
  },

  async findByStream(
    client: PoolClient,
    streamId: string,
    options?: { limit?: number; beforeSequence?: bigint },
  ): Promise<Message[]> {
    const limit = options?.limit ?? 50

    if (options?.beforeSequence) {
      const result = await client.query<MessageRow>(sql`
        SELECT ${sql.raw(SELECT_FIELDS)} FROM messages
        WHERE stream_id = ${streamId}
          AND sequence < ${options.beforeSequence.toString()}
          AND deleted_at IS NULL
        ORDER BY sequence DESC
        LIMIT ${limit}
      `)
      return result.rows.map(mapRowToMessage).reverse()
    }

    const result = await client.query<MessageRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM messages
      WHERE stream_id = ${streamId}
        AND deleted_at IS NULL
      ORDER BY sequence DESC
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToMessage).reverse()
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

  async updateContent(
    client: PoolClient,
    id: string,
    content: string,
  ): Promise<Message | null> {
    const result = await client.query<MessageRow>(sql`
      UPDATE messages
      SET content = ${content}, edited_at = NOW()
      WHERE id = ${id}
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return result.rows[0] ? mapRowToMessage(result.rows[0]) : null
  },

  async softDelete(client: PoolClient, id: string): Promise<Message | null> {
    const result = await client.query<MessageRow>(sql`
      UPDATE messages
      SET deleted_at = NOW()
      WHERE id = ${id}
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return result.rows[0] ? mapRowToMessage(result.rows[0]) : null
  },

  async addReaction(
    client: PoolClient,
    messageId: string,
    emoji: string,
    userId: string,
  ): Promise<Message | null> {
    // Add user to emoji's array, create array if doesn't exist
    const result = await client.query<MessageRow>(sql`
      UPDATE messages
      SET reactions = jsonb_set(
        COALESCE(reactions, '{}'::jsonb),
        ${`{${emoji}}`}::text[],
        COALESCE(reactions->${emoji}, '[]'::jsonb) || ${JSON.stringify([userId])}::jsonb
      )
      WHERE id = ${messageId}
        AND NOT (COALESCE(reactions->${emoji}, '[]'::jsonb) ? ${userId})
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return result.rows[0] ? mapRowToMessage(result.rows[0]) : this.findById(client, messageId)
  },

  async removeReaction(
    client: PoolClient,
    messageId: string,
    emoji: string,
    userId: string,
  ): Promise<Message | null> {
    const result = await client.query<MessageRow>(sql`
      UPDATE messages
      SET reactions = jsonb_set(
        reactions,
        ${`{${emoji}}`}::text[],
        (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
         FROM jsonb_array_elements(COALESCE(reactions->${emoji}, '[]'::jsonb)) elem
         WHERE elem::text != ${JSON.stringify(userId)})
      )
      WHERE id = ${messageId}
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return result.rows[0] ? mapRowToMessage(result.rows[0]) : null
  },

  async incrementReplyCount(client: PoolClient, id: string): Promise<void> {
    await client.query(sql`
      UPDATE messages
      SET reply_count = reply_count + 1
      WHERE id = ${id}
    `)
  },
}
