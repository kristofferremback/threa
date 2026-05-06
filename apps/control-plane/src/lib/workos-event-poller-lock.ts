import { randomUUID } from "crypto"
import type { Pool } from "pg"
import { calculateBackoffMs, logger, sql } from "@threa/backend-common"

export interface WorkosEventPollerLockConfig {
  pool: Pool
  /** Identifier for the poller — Phase 1 uses "workos-events". */
  name: string
  lockDurationMs: number
  refreshIntervalMs: number
  maxRetries: number
  baseBackoffMs: number
}

interface PollerStateRow {
  name: string
  last_event_id: string | null
  last_event_at: Date | null
  retry_count: number
  retry_after: Date | null
}

/**
 * Time-based lease for the WorkOS event poller. Modeled on
 * `packages/backend-common/src/outbox/cursor-lock.ts` but simpler:
 *
 * - Cursor type is `string | null` (WorkOS opaque event id), not `bigint`.
 * - No sliding-window dedup — WorkOS event ids are globally unique and
 *   idempotency in the mirror comes from the row-level `last_event_at` guard
 *   on upsert (see `WorkosAuthzRepository.upsertMembershipFromEvent`).
 *
 * Atomic claim uses `UPDATE ... WHERE locked_until IS NULL OR locked_until < now()`
 * (with a small clock-drift pad) so multiple control-plane instances can compete
 * safely without `pg_advisory_lock` (which the repo explicitly avoids per
 * `apps/backend/docs/distributed-cron-design.md`).
 */
export class WorkosEventPollerLock {
  private readonly pool: Pool
  private readonly name: string
  private readonly lockDurationMs: number
  private readonly refreshIntervalMs: number
  private readonly maxRetries: number
  private readonly baseBackoffMs: number

  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private runId: string | null = null

  constructor(config: WorkosEventPollerLockConfig) {
    this.pool = config.pool
    this.name = config.name
    this.lockDurationMs = config.lockDurationMs
    this.refreshIntervalMs = config.refreshIntervalMs
    this.maxRetries = config.maxRetries
    this.baseBackoffMs = config.baseBackoffMs
  }

  /** Ensure the poller-state row exists. Idempotent — safe to call on every boot. */
  async ensureRow(): Promise<void> {
    await this.pool.query(sql`
      INSERT INTO workos_event_poller_state (name)
      VALUES (${this.name})
      ON CONFLICT (name) DO NOTHING
    `)
  }

  /**
   * Try to claim the lease. Returns the persisted cursor on success, or
   * `null` if the lease is held by someone else or this poller is in retry
   * backoff. Holder must call {@link release} when done.
   */
  async tryAcquire(now: Date = new Date()): Promise<{ lastEventId: string | null; lastEventAt: Date | null } | null> {
    const ready = await this.isReadyToProcess(now)
    if (!ready) return null

    const lockedUntil = new Date(now.getTime() + this.lockDurationMs)
    const clockDriftPadMs = 100
    this.runId = randomUUID()

    const result = await this.pool.query<PollerStateRow>(sql`
      UPDATE workos_event_poller_state
      SET
        locked_until = ${lockedUntil},
        lock_run_id = ${this.runId},
        updated_at = ${now}
      WHERE name = ${this.name}
        AND (locked_until IS NULL OR locked_until < ${new Date(now.getTime() + clockDriftPadMs)})
      RETURNING name, last_event_id, last_event_at, retry_count, retry_after
    `)

    if (result.rows.length === 0) {
      this.runId = null
      return null
    }

    const row = result.rows[0]
    return { lastEventId: row.last_event_id, lastEventAt: row.last_event_at }
  }

  /** Persist cursor advance. Resets retry state because forward progress proves health. */
  async advance(lastEventId: string, lastEventAt: Date, now: Date = new Date()): Promise<void> {
    if (!this.runId) return
    await this.pool.query(sql`
      UPDATE workos_event_poller_state
      SET
        last_event_id = ${lastEventId},
        last_event_at = ${lastEventAt},
        retry_count = 0,
        retry_after = NULL,
        last_error = NULL,
        updated_at = ${now}
      WHERE name = ${this.name}
        AND lock_run_id = ${this.runId}
    `)
  }

  /** Stamp last_backfill_at after a successful backfill. */
  async stampBackfill(at: Date = new Date()): Promise<void> {
    await this.pool.query(sql`
      UPDATE workos_event_poller_state
      SET last_backfill_at = ${at}, updated_at = ${at}
      WHERE name = ${this.name}
    `)
  }

  /**
   * Record a poller error and apply exponential backoff via `retry_after`.
   * Returns whether to keep retrying (false once `maxRetries` is exceeded —
   * the caller should fall back to whatever escalation it wants; this lock
   * does not have a DLQ analog).
   */
  async recordError(message: string, now: Date = new Date()): Promise<{ shouldRetry: boolean }> {
    const result = await this.pool.query<{ retry_count: number }>(sql`
      UPDATE workos_event_poller_state
      SET
        retry_count = retry_count + 1,
        last_error = ${message},
        updated_at = ${now}
      WHERE name = ${this.name}
      RETURNING retry_count
    `)
    if (result.rows.length === 0) return { shouldRetry: false }

    const newRetryCount = result.rows[0].retry_count
    if (newRetryCount > this.maxRetries) {
      return { shouldRetry: false }
    }

    const backoffMs = calculateBackoffMs({ baseMs: this.baseBackoffMs, retryCount: newRetryCount })
    const retryAfter = new Date(now.getTime() + backoffMs)
    await this.pool.query(sql`
      UPDATE workos_event_poller_state
      SET retry_after = ${retryAfter}, updated_at = ${now}
      WHERE name = ${this.name}
    `)
    logger.warn(
      { name: this.name, retryCount: newRetryCount, retryAfter: retryAfter.toISOString() },
      "WorkOS event poller error, will retry after backoff"
    )
    return { shouldRetry: true }
  }

  /** Release the lease. Idempotent — safe to call on shutdown even if nothing held. */
  async release(): Promise<void> {
    if (!this.runId) return
    await this.pool.query(sql`
      UPDATE workos_event_poller_state
      SET locked_until = NULL, lock_run_id = NULL, updated_at = NOW()
      WHERE name = ${this.name} AND lock_run_id = ${this.runId}
    `)
    this.runId = null
  }

  /** Start the lease-refresh timer. Caller is responsible for calling {@link stopRefreshTimer}. */
  startRefreshTimer(): void {
    if (this.refreshTimer) return
    this.refreshTimer = setInterval(() => {
      this.refreshLock().catch((err) => {
        logger.error({ err, name: this.name }, "Failed to refresh WorkOS event poller lock")
      })
    }, this.refreshIntervalMs)
  }

  stopRefreshTimer(): void {
    if (!this.refreshTimer) return
    clearInterval(this.refreshTimer)
    this.refreshTimer = null
  }

  private async refreshLock(): Promise<void> {
    if (!this.runId) return
    const now = new Date()
    const lockedUntil = new Date(now.getTime() + this.lockDurationMs)
    await this.pool.query(sql`
      UPDATE workos_event_poller_state
      SET locked_until = ${lockedUntil}, updated_at = ${now}
      WHERE name = ${this.name} AND lock_run_id = ${this.runId}
    `)
  }

  private async isReadyToProcess(now: Date): Promise<boolean> {
    const result = await this.pool.query<{ retry_after: Date | null }>(sql`
      SELECT retry_after FROM workos_event_poller_state WHERE name = ${this.name}
    `)
    if (result.rows.length === 0) return false
    const retryAfter = result.rows[0].retry_after
    return retryAfter === null || now >= retryAfter
  }
}
