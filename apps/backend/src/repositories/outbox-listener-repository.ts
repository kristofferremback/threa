import { Pool, PoolClient } from "pg"
import { sql, withTransaction } from "../db"
import { calculateBackoffMs } from "../lib/backoff"
import { logger } from "../lib/logger"
import { OutboxRepository, OutboxEvent } from "./outbox-repository"

export interface ListenerState {
  listenerId: string
  lastProcessedId: bigint
  lastProcessedAt: Date | null
  retryCount: number
  retryAfter: Date | null
  lastError: string | null
}

interface ListenerRow {
  listener_id: string
  last_processed_id: string
  last_processed_at: Date | null
  retry_count: number
  retry_after: Date | null
  last_error: string | null
}

function mapRowToState(row: ListenerRow): ListenerState {
  return {
    listenerId: row.listener_id,
    lastProcessedId: BigInt(row.last_processed_id),
    lastProcessedAt: row.last_processed_at,
    retryCount: row.retry_count,
    retryAfter: row.retry_after,
    lastError: row.last_error,
  }
}

export const OutboxListenerRepository = {
  /**
   * Claims exclusive lock on a listener's cursor row.
   * This must be called within a transaction - the lock is held until COMMIT/ROLLBACK.
   * Returns null if listener doesn't exist or is already locked by another transaction.
   *
   * Uses SKIP LOCKED to prevent transaction build-up when multiple processes
   * compete for the same listener. Callers should retry via polling rather than blocking.
   */
  async claimListener(client: PoolClient, listenerId: string): Promise<ListenerState | null> {
    const result = await client.query<ListenerRow>(sql`
      SELECT
        listener_id,
        last_processed_id,
        last_processed_at,
        retry_count,
        retry_after,
        last_error
      FROM outbox_listeners
      WHERE listener_id = ${listenerId}
      FOR UPDATE SKIP LOCKED
    `)

    if (result.rows.length === 0) {
      return null
    }

    return mapRowToState(result.rows[0])
  },

  /**
   * Updates the cursor after successfully processing events.
   * Resets retry state on success.
   *
   * IMPORTANT: Must be called within a transaction where claimListener() was called first.
   */
  async updateCursor(client: PoolClient, listenerId: string, newCursor: bigint): Promise<void> {
    await client.query(sql`
      UPDATE outbox_listeners
      SET
        last_processed_id = ${newCursor.toString()},
        last_processed_at = NOW(),
        retry_count = 0,
        retry_after = NULL,
        last_error = NULL,
        updated_at = NOW()
      WHERE listener_id = ${listenerId}
    `)
  },

  /**
   * Records an error and sets up retry with exponential backoff.
   * Returns the new retry_after time, or null if max retries exceeded.
   *
   * IMPORTANT: Must be called within a transaction where claimListener() was called first.
   * The row lock from claimListener() prevents concurrent updates to retry_count.
   */
  async recordError(
    client: PoolClient,
    listenerId: string,
    error: string,
    maxRetries: number,
    baseBackoffMs: number
  ): Promise<Date | null> {
    // First get current retry count
    const current = await client.query<{ retry_count: number }>(sql`
      SELECT retry_count
      FROM outbox_listeners
      WHERE listener_id = ${listenerId}
    `)

    if (current.rows.length === 0) {
      return null
    }

    const newRetryCount = current.rows[0].retry_count + 1

    if (newRetryCount > maxRetries) {
      // Max retries exceeded - caller should move to dead letter
      return null
    }

    const backoffMs = calculateBackoffMs({ baseMs: baseBackoffMs, retryCount: newRetryCount })
    const retryAfter = new Date(Date.now() + backoffMs)

    await client.query(sql`
      UPDATE outbox_listeners
      SET
        retry_count = ${newRetryCount},
        retry_after = ${retryAfter},
        last_error = ${error},
        updated_at = NOW()
      WHERE listener_id = ${listenerId}
    `)

    return retryAfter
  },

  /**
   * Moves an event to the dead letter table after max retries exceeded.
   *
   * IMPORTANT: Must be called within a transaction where claimListener() was called first.
   */
  async moveToDeadLetter(client: PoolClient, listenerId: string, eventId: bigint, error: string): Promise<void> {
    await client.query(sql`
      INSERT INTO outbox_dead_letters (listener_id, outbox_event_id, error)
      VALUES (${listenerId}, ${eventId.toString()}, ${error})
    `)

    // Clear retry state so listener can continue with next event
    await client.query(sql`
      UPDATE outbox_listeners
      SET
        retry_count = 0,
        retry_after = NULL,
        last_error = NULL,
        updated_at = NOW()
      WHERE listener_id = ${listenerId}
    `)
  },

  /**
   * Checks if a listener is ready to process (not in retry backoff).
   */
  async isReadyToProcess(client: PoolClient, listenerId: string): Promise<boolean> {
    const result = await client.query<{ retry_after: Date | null }>(sql`
      SELECT retry_after
      FROM outbox_listeners
      WHERE listener_id = ${listenerId}
    `)

    if (result.rows.length === 0) {
      return false
    }

    const retryAfter = result.rows[0].retry_after
    if (retryAfter === null) {
      return true
    }

    return new Date() >= retryAfter
  },

  /**
   * Ensures a listener exists, creating it if necessary.
   * Used during startup to register new listeners.
   *
   * WARNING: Default startFromId=0 will cause new listeners to process ALL historical events.
   * Use ensureListenerFromLatest() to start from the current position instead.
   */
  async ensureListener(client: PoolClient, listenerId: string, startFromId: bigint = 0n): Promise<void> {
    await client.query(sql`
      INSERT INTO outbox_listeners (listener_id, last_processed_id)
      VALUES (${listenerId}, ${startFromId.toString()})
      ON CONFLICT (listener_id) DO NOTHING
    `)
  },

  /**
   * Ensures a listener exists, starting from the latest outbox event.
   * New listeners will only process events created after registration.
   * Use this for listeners that don't need to backfill historical events.
   */
  async ensureListenerFromLatest(client: PoolClient, listenerId: string): Promise<void> {
    await client.query(sql`
      INSERT INTO outbox_listeners (listener_id, last_processed_id)
      SELECT ${listenerId}, COALESCE(MAX(id), 0)
      FROM outbox
      ON CONFLICT (listener_id) DO NOTHING
    `)
  },
}

export const CLAIM_STATUS = {
  CLAIMED: "claimed",
  NOT_READY: "not_ready",
  NO_EVENTS: "no_events",
} as const

export type ClaimAndFetchResult =
  | { status: typeof CLAIM_STATUS.CLAIMED; events: OutboxEvent[]; lastEventId: bigint }
  | { status: typeof CLAIM_STATUS.NOT_READY }
  | { status: typeof CLAIM_STATUS.NO_EVENTS }

/**
 * Claims events for processing and immediately releases the connection.
 *
 * This is a two-phase approach designed to prevent connection pool exhaustion:
 * 1. Short transaction: claim lock, fetch events, advance cursor, COMMIT (release connection)
 * 2. Process events outside the transaction (no connection held)
 *
 * The cursor is advanced BEFORE processing (optimistic). This means:
 * - If processing fails, the event is "lost" from this listener's perspective
 * - Critical processing should dispatch to pg-boss for durability
 * - This matches the semantic that outbox is for fan-out/dispatch, not guaranteed delivery
 *
 * Why this design?
 * - Previous design held connection during handler execution
 * - Handlers could call withClient() for nested DB queries
 * - 9 listeners × (1 withClaim + N withClient) = pool exhaustion
 * - By releasing connection before handlers run, nested queries don't compete
 *
 * @example
 * ```ts
 * const result = await claimAndFetchEvents(pool, "broadcast", 100)
 * if (result.status === "claimed") {
 *   for (const event of result.events) {
 *     await handleEvent(event) // No connection held!
 *   }
 * }
 * ```
 */
export async function claimAndFetchEvents(
  pool: Pool,
  listenerId: string,
  batchSize: number = 100
): Promise<ClaimAndFetchResult> {
  return withTransaction(pool, async (client) => {
    // Check if we're in retry backoff
    const isReady = await OutboxListenerRepository.isReadyToProcess(client, listenerId)
    if (!isReady) {
      return { status: CLAIM_STATUS.NOT_READY }
    }

    // Claim exclusive lock on our cursor row
    // Returns null if already locked by another transaction (SKIP LOCKED) - this is expected
    const state = await OutboxListenerRepository.claimListener(client, listenerId)
    if (!state) {
      return { status: CLAIM_STATUS.NOT_READY }
    }

    // Fetch events after our cursor
    const events = await OutboxRepository.fetchAfterId(client, state.lastProcessedId, batchSize)
    if (events.length === 0) {
      return { status: CLAIM_STATUS.NO_EVENTS }
    }

    // Advance cursor BEFORE processing (optimistic claim)
    // This releases the "claim" on these events - they're ours now
    const lastEventId = events[events.length - 1].id
    await OutboxListenerRepository.updateCursor(client, listenerId, lastEventId)

    // Transaction commits here, releasing the connection
    return { status: CLAIM_STATUS.CLAIMED, events, lastEventId }
  })
}
