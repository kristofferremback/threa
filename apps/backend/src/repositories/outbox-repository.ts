import { PoolClient } from "pg"
import { sql } from "../db"

// JSON replacer that converts BigInt to string
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value
}

export interface OutboxEvent {
  id: bigint
  eventType: string
  payload: unknown
  createdAt: Date
  processedAt: Date | null
}

interface OutboxRow {
  id: string
  event_type: string
  payload: unknown
  created_at: Date
  processed_at: Date | null
}

function mapRowToOutbox(row: OutboxRow): OutboxEvent {
  return {
    id: BigInt(row.id),
    eventType: row.event_type,
    payload: row.payload,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  }
}

export const OutboxRepository = {
  async insert(
    client: PoolClient,
    eventType: string,
    payload: unknown,
  ): Promise<OutboxEvent> {
    const result = await client.query<OutboxRow>(sql`
      INSERT INTO outbox (event_type, payload)
      VALUES (${eventType}, ${JSON.stringify(payload, jsonReplacer)})
      RETURNING id, event_type, payload, created_at, processed_at
    `)
    return mapRowToOutbox(result.rows[0])
  },

  async fetchUnprocessed(
    client: PoolClient,
    limit: number = 100,
  ): Promise<OutboxEvent[]> {
    // Use FOR UPDATE SKIP LOCKED for concurrent processing
    const result = await client.query<OutboxRow>(sql`
      SELECT id, event_type, payload, created_at, processed_at
      FROM outbox
      WHERE processed_at IS NULL
      ORDER BY id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `)
    return result.rows.map(mapRowToOutbox)
  },

  async markProcessed(client: PoolClient, ids: bigint[]): Promise<void> {
    if (ids.length === 0) return

    const idStrings = ids.map((id) => id.toString())
    await client.query(sql`
      UPDATE outbox
      SET processed_at = NOW()
      WHERE id = ANY(${idStrings}::bigint[])
    `)
  },

  async deleteProcessed(client: PoolClient, olderThan: Date): Promise<number> {
    const result = await client.query(sql`
      DELETE FROM outbox
      WHERE processed_at IS NOT NULL
        AND processed_at < ${olderThan}
    `)
    return result.rowCount ?? 0
  },
}
