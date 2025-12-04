import type { PoolClient } from "pg"
import { sql } from "../lib/db"

/**
 * Parameters for inserting a message revision.
 */
export interface InsertRevisionParams {
  id: string
  messageId: string
  content: string
}

/**
 * Repository for message_revisions table operations.
 *
 * Design principles:
 * - Accepts PoolClient as first parameter (enables transaction control from service)
 * - Returns raw database rows (services handle mapping)
 * - No side effects (no outbox events, no external calls)
 */
export const MessageRevisionRepository = {
  /**
   * Insert a revision before editing a message.
   */
  async insertRevision(client: PoolClient, params: InsertRevisionParams): Promise<void> {
    await client.query(
      sql`INSERT INTO message_revisions (id, message_id, content)
          VALUES (${params.id}, ${params.messageId}, ${params.content})`,
    )
  },
}
