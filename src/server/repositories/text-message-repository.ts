import type { PoolClient } from "pg"
import { sql } from "../lib/db"

/**
 * Raw database row for text_messages table.
 */
export interface TextMessageRow {
  id: string
  content: string
  mentions: unknown[] // JSON array of mentions
  formatting: unknown | null // JSON formatting data
  created_at: Date
  search_vector: unknown | null // tsvector, not typically needed in app code
  contextual_header: string | null
  header_generated_at: Date | null
  enrichment_tier: number
  enrichment_signals: Record<string, unknown>
}

/**
 * Parameters for inserting a text message.
 */
export interface InsertTextMessageParams {
  id: string
  content: string
  mentions: unknown[]
}

/**
 * Repository for text_messages table operations.
 *
 * Design principles:
 * - Accepts PoolClient as first parameter (enables transaction control from service)
 * - Returns raw database rows (services handle mapping)
 * - No side effects (no outbox events, no external calls)
 * - Uses explicit field selection (no SELECT *)
 */
export const TextMessageRepository = {
  /**
   * Insert a new text message.
   */
  async insertTextMessage(client: PoolClient, params: InsertTextMessageParams): Promise<void> {
    await client.query(
      sql`INSERT INTO text_messages (id, content, mentions)
          VALUES (${params.id}, ${params.content}, ${JSON.stringify(params.mentions)})`,
    )
  },

  /**
   * Find a text message by ID.
   */
  async findTextMessageById(client: PoolClient, id: string): Promise<TextMessageRow | null> {
    const result = await client.query<TextMessageRow>(
      sql`SELECT
            id, content, mentions, formatting, created_at,
            contextual_header, header_generated_at,
            enrichment_tier, enrichment_signals
          FROM text_messages
          WHERE id = ${id}`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Update the content of a text message.
   */
  async updateTextMessageContent(
    client: PoolClient,
    id: string,
    content: string,
  ): Promise<void> {
    await client.query(
      sql`UPDATE text_messages
          SET content = ${content}
          WHERE id = ${id}`,
    )
  },
}
