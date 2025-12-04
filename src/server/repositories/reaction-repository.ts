import type { PoolClient } from "pg"
import { sql } from "../lib/db"

/**
 * Raw database row for message_reactions table.
 * Repositories return raw rows; services handle mapping to domain types.
 */
export interface ReactionRow {
  id: string
  message_id: string
  user_id: string
  reaction: string
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

/**
 * Parameters for inserting a reaction.
 */
export interface InsertReactionParams {
  id: string
  messageId: string
  userId: string
  reaction: string
}

/**
 * Repository for message_reactions table operations.
 *
 * Design principles:
 * - Accepts PoolClient as first parameter (enables transaction control from service)
 * - Returns raw database rows (services handle mapping)
 * - No side effects (no outbox events, no external calls)
 * - Uses explicit field selection (no SELECT *)
 */
export const ReactionRepository = {
  /**
   * Insert a reaction (upsert to handle duplicates).
   * Uses ON CONFLICT DO NOTHING to handle race conditions gracefully.
   */
  async insertReaction(client: PoolClient, params: InsertReactionParams): Promise<void> {
    await client.query(
      sql`INSERT INTO message_reactions (id, message_id, user_id, reaction)
          VALUES (${params.id}, ${params.messageId}, ${params.userId}, ${params.reaction})
          ON CONFLICT (message_id, user_id, reaction) DO NOTHING`,
    )
  },

  /**
   * Soft-delete a reaction by setting deleted_at.
   */
  async softDeleteReaction(
    client: PoolClient,
    messageId: string,
    userId: string,
    reaction: string,
  ): Promise<void> {
    await client.query(
      sql`UPDATE message_reactions
          SET deleted_at = NOW(), updated_at = NOW()
          WHERE message_id = ${messageId}
            AND user_id = ${userId}
            AND reaction = ${reaction}`,
    )
  },

  /**
   * Find all active reactions for an event/message.
   */
  async findReactionsByMessageId(
    client: PoolClient,
    messageId: string,
  ): Promise<ReactionRow[]> {
    const result = await client.query<ReactionRow>(
      sql`SELECT
            id, message_id, user_id, reaction,
            created_at, updated_at, deleted_at
          FROM message_reactions
          WHERE message_id = ${messageId}
            AND deleted_at IS NULL
          ORDER BY created_at ASC`,
    )
    return result.rows
  },

  /**
   * Count active reactions for an event/message.
   */
  async countReactionsByMessageId(client: PoolClient, messageId: string): Promise<number> {
    const result = await client.query<{ count: string }>(
      sql`SELECT COUNT(*)::text as count
          FROM message_reactions
          WHERE message_id = ${messageId}
            AND deleted_at IS NULL`,
    )
    return parseInt(result.rows[0].count, 10)
  },
}
