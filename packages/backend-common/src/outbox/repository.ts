import { sql, type Querier } from "../db/index"
import { bigIntReplacer } from "../serialization"

/**
 * Generic outbox event — no domain-specific types.
 * Apps define their own event type unions and payload maps on top of this.
 */
export interface OutboxEvent<T extends string = string> {
  id: bigint
  eventType: T
  payload: Record<string, unknown>
  createdAt: Date
}

interface OutboxRow {
  id: string
  event_type: string
  payload: unknown
  created_at: Date
}

interface RetentionWatermarkRow {
  listener_count: string
  min_last_processed_id: string | null
}

export interface DeleteRetainedOutboxEventsParams {
  maxEventId: bigint
  createdBefore: Date
  limit: number
}

function mapRowToOutbox(row: OutboxRow): OutboxEvent {
  return {
    id: BigInt(row.id),
    eventType: row.event_type,
    payload: row.payload as Record<string, unknown>,
    createdAt: row.created_at,
  }
}

export const OUTBOX_CHANNEL = "outbox_events"

export const OutboxRepository = {
  async insert<T extends string>(
    client: Querier,
    eventType: T,
    payload: Record<string, unknown>
  ): Promise<OutboxEvent<T>> {
    const result = await client.query<OutboxRow>(sql`
      INSERT INTO outbox (event_type, payload)
      VALUES (${eventType}, ${JSON.stringify(payload, bigIntReplacer)})
      RETURNING id, event_type, payload, created_at
    `)

    // Notify listeners that new events are available
    await client.query(`NOTIFY ${OUTBOX_CHANNEL}`)

    return mapRowToOutbox(result.rows[0]) as OutboxEvent<T>
  },

  async insertMany<T extends string>(
    client: Querier,
    entries: Array<{ eventType: T; payload: Record<string, unknown> }>
  ): Promise<OutboxEvent<T>[]> {
    if (entries.length === 0) return []

    const eventTypes = entries.map((e) => e.eventType)
    const payloads = entries.map((e) => JSON.stringify(e.payload, bigIntReplacer))

    const result = await client.query<OutboxRow>(
      `INSERT INTO outbox (event_type, payload)
       SELECT * FROM unnest($1::text[], $2::jsonb[])
       RETURNING id, event_type, payload, created_at`,
      [eventTypes, payloads]
    )

    await client.query(`NOTIFY ${OUTBOX_CHANNEL}`)

    return result.rows.map((r) => mapRowToOutbox(r) as OutboxEvent<T>)
  },

  /**
   * Fetches events after a cursor ID for cursor-based processing.
   * No locking - the caller should hold a lock on their listener's cursor row.
   *
   * @param excludeIds IDs to skip (already processed in the sliding window)
   */
  async fetchAfterId(
    client: Querier,
    afterId: bigint,
    limit: number = 100,
    excludeIds: bigint[] = []
  ): Promise<OutboxEvent[]> {
    if (excludeIds.length === 0) {
      const result = await client.query<OutboxRow>(sql`
        SELECT id, event_type, payload, created_at
        FROM outbox
        WHERE id > ${afterId.toString()}
        ORDER BY id
        LIMIT ${limit}
      `)
      return result.rows.map(mapRowToOutbox)
    }

    const excludeIdStrings = excludeIds.map((id) => id.toString())
    const result = await client.query<OutboxRow>(sql`
      SELECT id, event_type, payload, created_at
      FROM outbox
      WHERE id > ${afterId.toString()}
        AND id != ALL(${excludeIdStrings}::bigint[])
      ORDER BY id
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToOutbox)
  },

  /**
   * Returns the retention watermark for the specified listeners.
   * The watermark is the minimum cursor across all listeners.
   *
   * Safety behavior:
   * - Returns null if listenerIds is empty
   * - Returns null if any listener row is missing
   */
  async getRetentionWatermark(client: Querier, listenerIds: string[]): Promise<bigint | null> {
    if (listenerIds.length === 0) {
      return null
    }

    const result = await client.query<RetentionWatermarkRow>(sql`
      SELECT
        COUNT(*)::text AS listener_count,
        MIN(last_processed_id)::text AS min_last_processed_id
      FROM outbox_listeners
      WHERE listener_id = ANY(${listenerIds})
    `)

    const row = result.rows[0]
    const listenerCount = Number(row.listener_count)

    if (listenerCount !== listenerIds.length) {
      return null
    }

    if (row.min_last_processed_id === null) {
      return null
    }

    return BigInt(row.min_last_processed_id)
  },

  /**
   * Deletes outbox events that are both:
   * - At or before the listener watermark (safe for all listeners)
   * - Older than the retention cutoff
   *
   * Deletion is batched to keep transactions short.
   */
  async deleteRetainedEvents(client: Querier, params: DeleteRetainedOutboxEventsParams): Promise<number> {
    if (params.limit <= 0) {
      return 0
    }

    const result = await client.query(sql`
      WITH candidates AS (
        SELECT id
        FROM outbox
        WHERE id <= ${params.maxEventId.toString()}
          AND created_at < ${params.createdBefore}
        ORDER BY id
        LIMIT ${params.limit}
      )
      DELETE FROM outbox
      USING candidates
      WHERE outbox.id = candidates.id
    `)

    return result.rowCount ?? 0
  },
}
