import type { PoolClient } from "pg"
import { sql } from "../lib/db"

/**
 * Parameters for inserting a shared ref.
 */
export interface InsertSharedRefParams {
  id: string
  originalEventId: string
  context: string | null
}

/**
 * Repository for shared_refs table operations.
 *
 * Design principles:
 * - Accepts PoolClient as first parameter (enables transaction control from service)
 * - Returns raw database rows (services handle mapping)
 * - No side effects (no outbox events, no external calls)
 */
export const SharedRefRepository = {
  /**
   * Insert a shared ref for crossposts.
   */
  async insertSharedRef(client: PoolClient, params: InsertSharedRefParams): Promise<void> {
    await client.query(
      sql`INSERT INTO shared_refs (id, original_event_id, context)
          VALUES (${params.id}, ${params.originalEventId}, ${params.context})`,
    )
  },
}
