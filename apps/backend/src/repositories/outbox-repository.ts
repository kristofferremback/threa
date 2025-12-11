import { PoolClient } from "pg"
import { sql } from "../db"
import { bigIntReplacer } from "../lib/serialization"

export interface OutboxEvent {
  id: bigint
  eventType: string
  payload: unknown
  createdAt: Date
}

interface OutboxRow {
  id: string
  event_type: string
  payload: unknown
  created_at: Date
}

function mapRowToOutbox(row: OutboxRow): OutboxEvent {
  return {
    id: BigInt(row.id),
    eventType: row.event_type,
    payload: row.payload,
    createdAt: row.created_at,
  }
}

export const OUTBOX_CHANNEL = "outbox_events"

export const OutboxRepository = {
  async insert(
    client: PoolClient,
    eventType: string,
    payload: unknown,
  ): Promise<OutboxEvent> {
    const result = await client.query<OutboxRow>(sql`
      INSERT INTO outbox (event_type, payload)
      VALUES (${eventType}, ${JSON.stringify(payload, bigIntReplacer)})
      RETURNING id, event_type, payload, created_at
    `)

    // Notify listeners that new events are available
    await client.query(`NOTIFY ${OUTBOX_CHANNEL}`)

    return mapRowToOutbox(result.rows[0])
  },

  /**
   * Fetches events after a cursor ID for cursor-based processing.
   * No locking - the caller should hold a lock on their listener's cursor row.
   */
  async fetchAfterId(
    client: PoolClient,
    afterId: bigint,
    limit: number = 100,
  ): Promise<OutboxEvent[]> {
    const result = await client.query<OutboxRow>(sql`
      SELECT id, event_type, payload, created_at
      FROM outbox
      WHERE id > ${afterId.toString()}
      ORDER BY id
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToOutbox)
  },

  /**
   * Deletes events older than a given date that all listeners have processed.
   * This is a retention cleanup function.
   */
  async deleteOlderThan(client: PoolClient, olderThan: Date): Promise<number> {
    // Only delete events that all listeners have moved past
    const result = await client.query(sql`
      DELETE FROM outbox
      WHERE created_at < ${olderThan}
        AND id <= (SELECT MIN(last_processed_id) FROM outbox_listeners)
    `)
    return result.rowCount ?? 0
  },
}
