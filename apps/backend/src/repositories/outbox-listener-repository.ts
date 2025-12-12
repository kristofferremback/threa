import { Pool, PoolClient } from "pg"
import { sql, withTransaction } from "../db"
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
   *
   * IMPORTANT: Must be called within a transaction where claimListener() was called first.
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
   *
   * IMPORTANT: Must be called within a transaction where claimListener() was called first.
   * The row lock from claimListener() prevents concurrent updates to retry_count.
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
   *
   * IMPORTANT: Must be called within a transaction where claimListener() was called first.
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
   *
   * WARNING: Default startFromId=0 will cause new listeners to process ALL historical events.
   * Use ensureListenerFromLatest() to start from the current position instead.
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

  /**
   * Ensures a listener exists, starting from the latest outbox event.
   * New listeners will only process events created after registration.
   * Use this for listeners that don't need to backfill historical events.
   */
  async ensureListenerFromLatest(
    client: PoolClient,
    listenerId: string,
  ): Promise<void> {
    await client.query(sql`
      INSERT INTO outbox_listeners (listener_id, last_processed_id)
      SELECT ${listenerId}, COALESCE(MAX(id), 0)
      FROM outbox
      ON CONFLICT (listener_id) DO NOTHING
    `)
  },
}

/**
 * Simplified API provided to withClaim callbacks.
 * Encapsulates the client and listenerId to prevent misuse.
 */
export interface ClaimContext {
  /** Fetch events after the current cursor position */
  fetchEvents(limit?: number): Promise<OutboxEvent[]>
  /** Update cursor after successfully processing events */
  updateCursor(newCursor: bigint): Promise<void>
  /** Current listener state (cursor position, etc.) */
  state: ListenerState
}

export interface WithClaimConfig {
  maxRetries?: number
  baseBackoffMs?: number
}

const DEFAULT_CLAIM_CONFIG: Required<WithClaimConfig> = {
  maxRetries: 5,
  baseBackoffMs: 1000,
}

export type WithClaimResult =
  | { status: "processed"; lastProcessedId: bigint }
  | { status: "not_ready" }
  | { status: "no_events" }

/**
 * Encapsulates the claim-process-update cycle with proper error handling.
 *
 * Handles:
 * - Transaction management
 * - Readiness check (retry_after backoff)
 * - Claiming exclusive lock (FOR UPDATE)
 * - Error recording with exponential backoff
 * - Dead lettering after max retries
 *
 * The callback receives a simplified ClaimContext API with only the operations
 * that are safe to call within the claimed transaction.
 *
 * @example
 * ```ts
 * await withClaim(pool, "broadcast", async (ctx) => {
 *   const events = await ctx.fetchEvents(100)
 *   for (const event of events) {
 *     await handleEvent(event)
 *   }
 *   if (events.length > 0) {
 *     await ctx.updateCursor(events[events.length - 1].id)
 *   }
 * })
 * ```
 */
export async function withClaim(
  pool: Pool,
  listenerId: string,
  callback: (ctx: ClaimContext) => Promise<void>,
  config?: WithClaimConfig,
): Promise<WithClaimResult> {
  const { maxRetries, baseBackoffMs } = { ...DEFAULT_CLAIM_CONFIG, ...config }

  return withTransaction(pool, async (client) => {
    // Check if we're in retry backoff
    const isReady = await OutboxListenerRepository.isReadyToProcess(
      client,
      listenerId,
    )
    if (!isReady) {
      return { status: "not_ready" as const }
    }

    // Claim exclusive lock on our cursor row
    const state = await OutboxListenerRepository.claimListener(
      client,
      listenerId,
    )
    if (!state) {
      logger.warn({ listenerId }, "Listener not found in database")
      return { status: "not_ready" as const }
    }

    // Track cursor updates within this transaction
    let currentCursor = state.lastProcessedId
    let cursorUpdated = false

    // Build the simplified context API
    const ctx: ClaimContext = {
      state,
      async fetchEvents(limit = 100) {
        return OutboxRepository.fetchAfterId(client, currentCursor, limit)
      },
      async updateCursor(newCursor: bigint) {
        await OutboxListenerRepository.updateCursor(client, listenerId, newCursor)
        currentCursor = newCursor
        cursorUpdated = true
      },
    }

    try {
      await callback(ctx)
      return cursorUpdated
        ? { status: "processed" as const, lastProcessedId: currentCursor }
        : { status: "no_events" as const }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      logger.error(
        { err, listenerId, lastProcessedId: currentCursor.toString() },
        "Error in withClaim callback",
      )

      // Try to schedule retry
      const retryAfter = await OutboxListenerRepository.recordError(
        client,
        listenerId,
        errorMessage,
        maxRetries,
        baseBackoffMs,
      )

      if (retryAfter === null) {
        // Max retries exceeded - move current event to dead letter
        // We need to know which event failed - it's the one after currentCursor
        const failedEvents = await OutboxRepository.fetchAfterId(client, currentCursor, 1)
        if (failedEvents.length > 0) {
          const failedEvent = failedEvents[0]
          logger.error(
            {
              listenerId,
              eventId: failedEvent.id.toString(),
              eventType: failedEvent.eventType,
            },
            "Max retries exceeded, moving to dead letter",
          )
          await OutboxListenerRepository.moveToDeadLetter(
            client,
            listenerId,
            failedEvent.id,
            errorMessage,
          )
          // Update cursor past this event so we continue with the next
          await OutboxListenerRepository.updateCursor(
            client,
            listenerId,
            failedEvent.id,
          )
        }
      }

      // Re-throw so the transaction commits with the error state recorded
      // (we want the retry_count and dead_letter updates to persist)
      // Actually, we should NOT re-throw - we've handled the error
      return { status: "not_ready" as const }
    }
  })
}
