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

/**
 * Per-event processing state against one listener, suitable for surfacing
 * outbox propagation progress in operator UIs.
 *
 * - `processed`: the listener has fully handled the event (cursor advanced
 *   past it, or it sits in the sliding-window of recently-processed ids).
 * - `pending`: the listener has not yet processed the event. It may still be
 *   draining normally, in retry backoff, or stuck — the state can't tell
 *   those apart without inspecting `outbox_listeners.retry_after`.
 * - `dead_lettered`: the listener gave up after `maxRetries` and moved the
 *   event to `outbox_dead_letters`. Fan-out for this event will not retry
 *   without operator intervention.
 */
export type OutboxEventProcessingStatus = "processed" | "pending" | "dead_lettered"

export interface OutboxEventStatus {
  id: string
  status: OutboxEventProcessingStatus
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
   * Reports per-event processing state against a single listener. Used by
   * operator UIs that trigger work and want to watch its propagation.
   *
   * An event is `processed` when its id is at or below the listener's base
   * cursor (`last_processed_id`), or appears in its sliding-window
   * `processed_ids` map (handled but cursor hasn't compacted past it yet).
   * Events in `outbox_dead_letters` for the listener are surfaced as
   * `dead_lettered` regardless of cursor — fan-out gave up on them and
   * silently advancing the cursor past would otherwise look like success.
   *
   * Returns one entry per input id, preserving input order. Missing listener
   * row returns all events as `pending` (the listener hasn't bootstrapped
   * yet, so by definition nothing it owns is processed).
   */
  async getEventStatuses(client: Querier, listenerId: string, eventIds: bigint[]): Promise<OutboxEventStatus[]> {
    if (eventIds.length === 0) return []

    const eventIdStrings = eventIds.map((id) => id.toString())

    const [listenerResult, dlqResult] = await Promise.all([
      client.query<{ last_processed_id: string; processed_ids: Record<string, string> | null }>(sql`
        SELECT last_processed_id, processed_ids
        FROM outbox_listeners
        WHERE listener_id = ${listenerId}
      `),
      client.query<{ outbox_event_id: string }>(sql`
        SELECT outbox_event_id::text AS outbox_event_id
        FROM outbox_dead_letters
        WHERE listener_id = ${listenerId}
          AND outbox_event_id = ANY(${eventIdStrings}::bigint[])
      `),
    ])

    const dlqIds = new Set(dlqResult.rows.map((r) => r.outbox_event_id))

    if (listenerResult.rows.length === 0) {
      return eventIds.map((id) => {
        const idStr = id.toString()
        return { id: idStr, status: dlqIds.has(idStr) ? "dead_lettered" : "pending" }
      })
    }

    const row = listenerResult.rows[0]
    const cursor = BigInt(row.last_processed_id)
    const processedSet = new Set(Object.keys(row.processed_ids ?? {}))

    return eventIds.map((id) => {
      const idStr = id.toString()
      if (dlqIds.has(idStr)) {
        return { id: idStr, status: "dead_lettered" }
      }
      if (id <= cursor || processedSet.has(idStr)) {
        return { id: idStr, status: "processed" }
      }
      return { id: idStr, status: "pending" }
    })
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
