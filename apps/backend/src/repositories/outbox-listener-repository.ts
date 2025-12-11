import { PoolClient } from "pg"
import { sql } from "../db"

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
   * Returns null if listener doesn't exist.
   */
  async claimListener(
    client: PoolClient,
    listenerId: string,
  ): Promise<ListenerState | null> {
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
      FOR UPDATE
    `)

    if (result.rows.length === 0) {
      return null
    }

    return mapRowToState(result.rows[0])
  },

  /**
   * Updates the cursor after successfully processing events.
   * Resets retry state on success.
   */
  async updateCursor(
    client: PoolClient,
    listenerId: string,
    newCursor: bigint,
  ): Promise<void> {
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
   */
  async recordError(
    client: PoolClient,
    listenerId: string,
    error: string,
    maxRetries: number,
    baseBackoffMs: number,
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

    // Exponential backoff with jitter: base * 2^(retry-1) + random(0-base)
    const backoffMs =
      baseBackoffMs * Math.pow(2, newRetryCount - 1) +
      Math.random() * baseBackoffMs
    // Cap at 5 minutes
    const cappedBackoffMs = Math.min(backoffMs, 5 * 60 * 1000)
    const retryAfter = new Date(Date.now() + cappedBackoffMs)

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
   */
  async moveToDeadLetter(
    client: PoolClient,
    listenerId: string,
    eventId: bigint,
    error: string,
  ): Promise<void> {
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
  async isReadyToProcess(
    client: PoolClient,
    listenerId: string,
  ): Promise<boolean> {
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
   */
  async ensureListener(
    client: PoolClient,
    listenerId: string,
    startFromId: bigint = 0n,
  ): Promise<void> {
    await client.query(sql`
      INSERT INTO outbox_listeners (listener_id, last_processed_id)
      VALUES (${listenerId}, ${startFromId.toString()})
      ON CONFLICT (listener_id) DO NOTHING
    `)
  },
}
