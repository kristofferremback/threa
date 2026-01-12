import { Pool, PoolClient } from "pg"
import { sql, withClient } from "../db"
import { calculateBackoffMs } from "./backoff"
import { logger } from "./logger"
import { OutboxRepository } from "../repositories/outbox-repository"

export interface CursorLockConfig {
  pool: Pool
  listenerId: string
  lockDurationMs: number // e.g., 10000 (10s)
  refreshIntervalMs: number // e.g., 5000 (5s)
  maxRetries: number // e.g., 5
  baseBackoffMs: number // e.g., 1000 (1s)
  batchSize: number // e.g., 100
}

export type ProcessResult =
  | { status: "processed"; newCursor: bigint }
  | { status: "no_events" }
  | { status: "error"; error: Error; newCursor?: bigint }

interface ListenerLockState {
  listenerId: string
  lastProcessedId: bigint
  retryCount: number
  retryAfter: Date | null
  lockedUntil: Date | null
  lockRunId: string | null
}

interface ListenerLockRow {
  listener_id: string
  last_processed_id: string
  retry_count: number
  retry_after: Date | null
  locked_until: Date | null
  lock_run_id: string | null
}

function mapRowToState(row: ListenerLockRow): ListenerLockState {
  return {
    listenerId: row.listener_id,
    lastProcessedId: BigInt(row.last_processed_id),
    retryCount: row.retry_count,
    retryAfter: row.retry_after,
    lockedUntil: row.locked_until,
    lockRunId: row.lock_run_id,
  }
}

function generateRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Time-based cursor lock for outbox event processing.
 *
 * Instead of holding a database transaction open during processing,
 * this uses a time-based lock that can be refreshed. This prevents
 * connection pool exhaustion while maintaining exclusive cursor access.
 *
 * Flow:
 * 1. Check if in backoff (retry_after > now) → return false
 * 2. Try to claim lock → if failed, return false
 * 3. Start refresh timer
 * 4. Exhaust loop: repeatedly call processor until no_events or error
 * 5. Handle results (update cursor, record error, DLQ)
 * 6. Release lock, stop timer
 */
export class CursorLock {
  readonly batchSize: number

  private readonly pool: Pool
  private readonly listenerId: string
  private readonly lockDurationMs: number
  private readonly refreshIntervalMs: number
  private readonly maxRetries: number
  private readonly baseBackoffMs: number

  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private runId: string | null = null

  constructor(config: CursorLockConfig) {
    this.pool = config.pool
    this.listenerId = config.listenerId
    this.lockDurationMs = config.lockDurationMs
    this.refreshIntervalMs = config.refreshIntervalMs
    this.maxRetries = config.maxRetries
    this.baseBackoffMs = config.baseBackoffMs
    this.batchSize = config.batchSize
  }

  /**
   * Try to acquire lock and exhaust events by repeatedly calling processor.
   *
   * @param processor Function that processes a batch of events starting from cursor.
   *                  Returns ProcessResult indicating success, no events, or error.
   * @param getNow Optional function to get current time (for testing).
   * @returns true if any work was done, false if lock unavailable or in backoff.
   */
  async run(
    processor: (cursor: bigint) => Promise<ProcessResult>,
    getNow: () => Date = () => new Date()
  ): Promise<boolean> {
    const now = getNow()

    // Check if we're in retry backoff
    const isReady = await this.isReadyToProcess(now)
    if (!isReady) {
      return false
    }

    // Try to claim lock
    const lockResult = await this.tryClaimLock(now)
    if (!lockResult) {
      return false
    }

    let { cursor } = lockResult
    let didWork = false

    try {
      // Start refresh timer
      this.startRefreshTimer(getNow)

      // Exhaust loop: keep processing until no more events or error
      let continueProcessing = true
      while (continueProcessing) {
        const result = await processor(cursor)

        switch (result.status) {
          case "processed": {
            // Validate cursor moved forward
            if (result.newCursor <= cursor) {
              logger.error(
                { listenerId: this.listenerId, oldCursor: cursor.toString(), newCursor: result.newCursor.toString() },
                "Cursor did not advance - sanity check failed"
              )
              continueProcessing = false
              break
            }

            // Update cursor and reset retry state
            await this.updateCursor(result.newCursor, getNow())
            cursor = result.newCursor
            didWork = true
            break
          }

          case "no_events": {
            // Cursor exhausted, exit loop
            continueProcessing = false
            break
          }

          case "error": {
            // Handle partial progress if newCursor provided
            if (result.newCursor !== undefined && result.newCursor > cursor) {
              await this.updateCursor(result.newCursor, getNow())
              cursor = result.newCursor
              didWork = true
            }

            // Record error and handle circuit breaker
            const shouldRetry = await this.recordError(result.error.message, getNow())

            if (!shouldRetry) {
              // Max retries exceeded - move first event to DLQ
              await this.moveFirstEventToDLQ(cursor, result.error.message)
            }

            continueProcessing = false
            break
          }
        }
      }
    } finally {
      // Always release lock and stop timer
      this.stopRefreshTimer()
      await this.releaseLock()
    }

    return didWork
  }

  private async isReadyToProcess(now: Date): Promise<boolean> {
    return withClient(this.pool, async (client) => {
      const result = await client.query<{ retry_after: Date | null }>(sql`
        SELECT retry_after
        FROM outbox_listeners
        WHERE listener_id = ${this.listenerId}
      `)

      if (result.rows.length === 0) {
        return false
      }

      const retryAfter = result.rows[0].retry_after
      if (retryAfter === null) {
        return true
      }

      return now >= retryAfter
    })
  }

  private async tryClaimLock(now: Date): Promise<{ cursor: bigint } | null> {
    this.runId = generateRunId()
    const lockedUntil = new Date(now.getTime() + this.lockDurationMs)

    // Pad 100ms for clock drift
    const clockDriftPadMs = 100

    return withClient(this.pool, async (client) => {
      const result = await client.query<ListenerLockRow>(sql`
        UPDATE outbox_listeners
        SET
          locked_until = ${lockedUntil},
          lock_run_id = ${this.runId},
          updated_at = ${now}
        WHERE listener_id = ${this.listenerId}
          AND (locked_until IS NULL OR locked_until < ${new Date(now.getTime() + clockDriftPadMs)})
        RETURNING
          listener_id,
          last_processed_id,
          retry_count,
          retry_after,
          locked_until,
          lock_run_id
      `)

      if (result.rows.length === 0) {
        this.runId = null
        return null
      }

      const state = mapRowToState(result.rows[0])
      return { cursor: state.lastProcessedId }
    })
  }

  private startRefreshTimer(getNow: () => Date): void {
    this.refreshTimer = setInterval(() => {
      this.refreshLock(getNow).catch((err) => {
        logger.error({ err, listenerId: this.listenerId }, "Failed to refresh cursor lock")
      })
    }, this.refreshIntervalMs)
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private async refreshLock(getNow: () => Date): Promise<void> {
    if (!this.runId) return

    const now = getNow()
    const lockedUntil = new Date(now.getTime() + this.lockDurationMs)

    await withClient(this.pool, async (client) => {
      await client.query(sql`
        UPDATE outbox_listeners
        SET
          locked_until = ${lockedUntil},
          updated_at = ${now}
        WHERE listener_id = ${this.listenerId}
          AND lock_run_id = ${this.runId}
      `)
    })
  }

  private async releaseLock(): Promise<void> {
    if (!this.runId) return

    await withClient(this.pool, async (client) => {
      await client.query(sql`
        UPDATE outbox_listeners
        SET
          locked_until = NULL,
          lock_run_id = NULL,
          updated_at = NOW()
        WHERE listener_id = ${this.listenerId}
          AND lock_run_id = ${this.runId}
      `)
    })

    this.runId = null
  }

  private async updateCursor(newCursor: bigint, now: Date): Promise<void> {
    await withClient(this.pool, async (client) => {
      await client.query(sql`
        UPDATE outbox_listeners
        SET
          last_processed_id = ${newCursor.toString()},
          last_processed_at = ${now},
          retry_count = 0,
          retry_after = NULL,
          last_error = NULL,
          updated_at = ${now}
        WHERE listener_id = ${this.listenerId}
      `)
    })
  }

  /**
   * Records an error and sets up retry with exponential backoff.
   * Returns true if should retry, false if max retries exceeded.
   */
  private async recordError(errorMessage: string, now: Date): Promise<boolean> {
    return withClient(this.pool, async (client) => {
      const current = await client.query<{ retry_count: number }>(sql`
        SELECT retry_count
        FROM outbox_listeners
        WHERE listener_id = ${this.listenerId}
      `)

      if (current.rows.length === 0) {
        return false
      }

      const newRetryCount = current.rows[0].retry_count + 1

      if (newRetryCount > this.maxRetries) {
        return false
      }

      const backoffMs = calculateBackoffMs({ baseMs: this.baseBackoffMs, retryCount: newRetryCount })
      const retryAfter = new Date(now.getTime() + backoffMs)

      await client.query(sql`
        UPDATE outbox_listeners
        SET
          retry_count = ${newRetryCount},
          retry_after = ${retryAfter},
          last_error = ${errorMessage},
          updated_at = ${now}
        WHERE listener_id = ${this.listenerId}
      `)

      logger.warn(
        { listenerId: this.listenerId, retryCount: newRetryCount, retryAfter: retryAfter.toISOString() },
        "Recorded error, will retry after backoff"
      )

      return true
    })
  }

  private async moveFirstEventToDLQ(cursor: bigint, errorMessage: string): Promise<void> {
    await withClient(this.pool, async (client) => {
      // Fetch the first event after cursor (the one that failed)
      const events = await OutboxRepository.fetchAfterId(client, cursor, 1)
      if (events.length === 0) {
        logger.warn({ listenerId: this.listenerId, cursor: cursor.toString() }, "No event to move to DLQ")
        return
      }

      const event = events[0]

      // Insert into dead letter queue
      await client.query(sql`
        INSERT INTO outbox_dead_letters (listener_id, outbox_event_id, error)
        VALUES (${this.listenerId}, ${event.id.toString()}, ${errorMessage})
      `)

      // Advance cursor past this event and reset retry state
      await client.query(sql`
        UPDATE outbox_listeners
        SET
          last_processed_id = ${event.id.toString()},
          last_processed_at = NOW(),
          retry_count = 0,
          retry_after = NULL,
          last_error = NULL,
          updated_at = NOW()
        WHERE listener_id = ${this.listenerId}
      `)

      logger.error(
        { listenerId: this.listenerId, eventId: event.id.toString(), eventType: event.eventType },
        "Moved event to dead letter queue after max retries"
      )
    })
  }
}

/**
 * Ensures a listener exists, creating it if necessary.
 * Used during startup to register new listeners.
 *
 * WARNING: Default startFromId=0 will cause new listeners to process ALL historical events.
 * Use ensureListenerFromLatest() to start from the current position instead.
 */
export async function ensureListener(pool: Pool, listenerId: string, startFromId: bigint = 0n): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query(sql`
      INSERT INTO outbox_listeners (listener_id, last_processed_id)
      VALUES (${listenerId}, ${startFromId.toString()})
      ON CONFLICT (listener_id) DO NOTHING
    `)
  })
}

/**
 * Ensures a listener exists, starting from the latest outbox event.
 * New listeners will only process events created after registration.
 * Use this for listeners that don't need to backfill historical events.
 */
export async function ensureListenerFromLatest(pool: Pool, listenerId: string): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query(sql`
      INSERT INTO outbox_listeners (listener_id, last_processed_id)
      SELECT ${listenerId}, COALESCE(MAX(id), 0)
      FROM outbox
      ON CONFLICT (listener_id) DO NOTHING
    `)
  })
}
