import type { Querier } from "../db"
import { sql } from "../db"
import { tickId } from "../lib/id"

// Internal row types (snake_case)
interface CronScheduleRow {
  id: string
  queue_name: string
  interval_seconds: number
  payload: unknown
  workspace_id: string | null
  next_tick_needed_at: Date
  enabled: boolean
  created_at: Date
  updated_at: Date
}

interface CronTickRow {
  id: string
  schedule_id: string
  queue_name: string
  payload: unknown
  workspace_id: string | null
  execute_at: Date
  leased_at: Date | null
  leased_by: string | null
  leased_until: Date | null
  created_at: Date
}

// Domain types (camelCase)
export interface CronSchedule {
  id: string
  queueName: string
  intervalSeconds: number
  payload: unknown
  workspaceId: string | null
  nextTickNeededAt: Date
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CronTick {
  id: string
  scheduleId: string
  queueName: string
  payload: unknown
  workspaceId: string | null
  executeAt: Date
  leasedAt: Date | null
  leasedBy: string | null
  leasedUntil: Date | null
  createdAt: Date
}

// Parameter types
export interface CreateScheduleParams {
  id: string
  queueName: string
  intervalSeconds: number
  payload: unknown
  workspaceId: string | null
}

export interface FindSchedulesNeedingTicksParams {
  lookaheadSeconds: number
  limit: number
}

export interface CreateTicksParams {
  schedules: Array<{
    scheduleId: string
    queueName: string
    payload: unknown
    workspaceId: string | null
    executeAt: Date
    intervalSeconds: number
  }>
}

export interface BatchLeaseTicksParams {
  leasedBy: string
  leasedUntil: Date
  limit: number
  now: Date
}

export interface DeleteTickParams {
  tickId: string
  leasedBy: string
}

export interface DeleteExpiredTicksParams {
  expiredBefore: Date
}

// Mappers
function mapRowToSchedule(row: CronScheduleRow): CronSchedule {
  return {
    id: row.id,
    queueName: row.queue_name,
    intervalSeconds: row.interval_seconds,
    payload: row.payload,
    workspaceId: row.workspace_id,
    nextTickNeededAt: row.next_tick_needed_at,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapRowToTick(row: CronTickRow): CronTick {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    queueName: row.queue_name,
    payload: row.payload,
    workspaceId: row.workspace_id,
    executeAt: row.execute_at,
    leasedAt: row.leased_at,
    leasedBy: row.leased_by,
    leasedUntil: row.leased_until,
    createdAt: row.created_at,
  }
}

export const CronRepository = {
  /**
   * Create a new cron schedule.
   */
  async createSchedule(db: Querier, params: CreateScheduleParams): Promise<CronSchedule> {
    const result = await db.query<CronScheduleRow>(
      sql`
        INSERT INTO cron_schedules (
          id, queue_name, interval_seconds, payload, workspace_id
        ) VALUES (
          ${params.id},
          ${params.queueName},
          ${params.intervalSeconds},
          ${JSON.stringify(params.payload)},
          ${params.workspaceId}
        )
        RETURNING
          id, queue_name, interval_seconds, payload, workspace_id,
          next_tick_needed_at, enabled, created_at, updated_at
      `
    )
    return mapRowToSchedule(result.rows[0])
  },

  /**
   * Find schedules that need tick generation soon.
   * Only returns enabled schedules whose next_tick_needed_at is within lookahead window.
   */
  async findSchedulesNeedingTicks(db: Querier, params: FindSchedulesNeedingTicksParams): Promise<CronSchedule[]> {
    const lookaheadInterval = `${params.lookaheadSeconds} seconds`
    const result = await db.query<CronScheduleRow>(
      sql`
        SELECT
          id, queue_name, interval_seconds, payload, workspace_id,
          next_tick_needed_at, enabled, created_at, updated_at
        FROM cron_schedules
        WHERE enabled = true
          AND next_tick_needed_at <= NOW() + ${lookaheadInterval}::interval
        ORDER BY next_tick_needed_at ASC
        LIMIT ${params.limit}
      `
    )
    return result.rows.map(mapRowToSchedule)
  },

  /**
   * Create tick tokens for schedules.
   * UNIQUE constraint on (schedule_id, execute_at) prevents duplicates.
   *
   * After creating ticks, updates each schedule's next_tick_needed_at.
   */
  async createTicks(db: Querier, params: CreateTicksParams): Promise<CronTick[]> {
    if (params.schedules.length === 0) {
      return []
    }

    // Build VALUES for batch insert
    const tickValues: unknown[] = []
    const updateValues: unknown[] = []
    let tickIdx = 1
    let updateIdx = 1

    const tickPlaceholders: string[] = []
    const updateCases: string[] = []
    const scheduleIds: string[] = []

    for (const sched of params.schedules) {
      // Generate tick (jitter applied by caller)
      tickPlaceholders.push(
        `($${tickIdx++}, $${tickIdx++}, $${tickIdx++}, $${tickIdx++}::jsonb, $${tickIdx++}, ` +
          `$${tickIdx++}::timestamptz, NOW())`
      )
      tickValues.push(
        tickId(),
        sched.scheduleId,
        sched.queueName,
        JSON.stringify(sched.payload),
        sched.workspaceId,
        sched.executeAt
      )

      // Update schedule's next_tick_needed_at
      updateCases.push(`WHEN id = $${updateIdx++} THEN $${updateIdx++}::timestamptz`)
      updateValues.push(sched.scheduleId, new Date(sched.executeAt.getTime() + sched.intervalSeconds * 1000))
      scheduleIds.push(sched.scheduleId)
    }

    // Insert ticks
    const tickResult = await db.query<CronTickRow>(
      `INSERT INTO cron_ticks (
        id, schedule_id, queue_name, payload, workspace_id, execute_at, created_at
      ) VALUES ${tickPlaceholders.join(", ")}
      ON CONFLICT (schedule_id, execute_at) DO NOTHING
      RETURNING
        id, schedule_id, queue_name, payload, workspace_id,
        execute_at, leased_at, leased_by, leased_until, created_at`,
      tickValues
    )

    // Update schedules' next_tick_needed_at
    if (updateCases.length > 0) {
      await db.query(
        `UPDATE cron_schedules
        SET next_tick_needed_at = CASE ${updateCases.join(" ")} END,
            updated_at = NOW()
        WHERE id = ANY($${updateIdx})`,
        [...updateValues, scheduleIds]
      )
    }

    return tickResult.rows.map(mapRowToTick)
  },

  /**
   * Batch lease ticks that are ready for execution.
   * Only one worker can lease each tick (FOR UPDATE SKIP LOCKED).
   */
  async batchLeaseTicks(db: Querier, params: BatchLeaseTicksParams): Promise<CronTick[]> {
    const result = await db.query<CronTickRow>(
      sql`
        WITH available_ticks AS (
          SELECT
            id, schedule_id, queue_name, payload, workspace_id, execute_at
          FROM cron_ticks
          WHERE execute_at <= ${params.now}
            AND (leased_until IS NULL OR leased_until < ${params.now})
          ORDER BY execute_at ASC
          LIMIT ${params.limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE cron_ticks
        SET
          leased_at = ${params.now},
          leased_by = ${params.leasedBy},
          leased_until = ${params.leasedUntil}
        FROM available_ticks
        WHERE cron_ticks.id = available_ticks.id
        RETURNING
          cron_ticks.id,
          cron_ticks.schedule_id,
          cron_ticks.queue_name,
          cron_ticks.payload,
          cron_ticks.workspace_id,
          cron_ticks.execute_at,
          cron_ticks.leased_at,
          cron_ticks.leased_by,
          cron_ticks.leased_until,
          cron_ticks.created_at
      `
    )

    return result.rows.map(mapRowToTick)
  },

  /**
   * Delete a tick after execution.
   * Verifies leasedBy to prevent race conditions.
   */
  async deleteTick(db: Querier, params: DeleteTickParams): Promise<void> {
    const result = await db.query(
      sql`
        DELETE FROM cron_ticks
        WHERE id = ${params.tickId}
          AND leased_by = ${params.leasedBy}
      `
    )

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Failed to delete tick ${params.tickId}: not found or wrong leasedBy`)
    }
  },

  /**
   * Delete expired ticks (lease expired, not completed).
   * Called by cleanup worker.
   */
  async deleteExpiredTicks(db: Querier, params: DeleteExpiredTicksParams): Promise<number> {
    const result = await db.query(
      sql`
        DELETE FROM cron_ticks
        WHERE leased_until IS NOT NULL
          AND leased_until < ${params.expiredBefore}
      `
    )

    return result.rowCount ?? 0
  },

  /**
   * Delete orphaned ticks (schedule was deleted).
   * Called by cleanup worker.
   */
  async deleteOrphanedTicks(db: Querier): Promise<number> {
    const result = await db.query(
      sql`
        DELETE FROM cron_ticks
        WHERE schedule_id NOT IN (SELECT id FROM cron_schedules)
      `
    )

    return result.rowCount ?? 0
  },

  /**
   * Disable a schedule (pause without deleting).
   */
  async disableSchedule(db: Querier, scheduleId: string): Promise<void> {
    const result = await db.query(
      sql`
        UPDATE cron_schedules
        SET enabled = false, updated_at = NOW()
        WHERE id = ${scheduleId}
      `
    )

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Failed to disable schedule ${scheduleId}: not found`)
    }
  },

  /**
   * Enable a schedule and regenerate tick immediately.
   */
  async enableSchedule(db: Querier, scheduleId: string): Promise<void> {
    const result = await db.query(
      sql`
        UPDATE cron_schedules
        SET
          enabled = true,
          next_tick_needed_at = NOW(),
          updated_at = NOW()
        WHERE id = ${scheduleId}
      `
    )

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Failed to enable schedule ${scheduleId}: not found`)
    }
  },

  /**
   * Delete a schedule permanently.
   * Orphaned ticks will be cleaned up by cleanup worker.
   */
  async deleteSchedule(db: Querier, scheduleId: string): Promise<void> {
    // Delete pending ticks first (not currently executing)
    await db.query(
      sql`
        DELETE FROM cron_ticks
        WHERE schedule_id = ${scheduleId}
          AND leased_until IS NULL
      `
    )

    // Delete the schedule
    const result = await db.query(
      sql`
        DELETE FROM cron_schedules
        WHERE id = ${scheduleId}
      `
    )

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Failed to delete schedule ${scheduleId}: not found`)
    }
  },

  /**
   * Update schedule interval.
   * Sets next_tick_needed_at to NOW to regenerate with new interval.
   */
  async updateScheduleInterval(db: Querier, scheduleId: string, intervalSeconds: number): Promise<void> {
    const result = await db.query(
      sql`
        UPDATE cron_schedules
        SET
          interval_seconds = ${intervalSeconds},
          next_tick_needed_at = NOW(),
          updated_at = NOW()
        WHERE id = ${scheduleId}
      `
    )

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Failed to update schedule ${scheduleId}: not found`)
    }
  },

  /**
   * Get schedule by ID (for testing/debugging).
   */
  async getScheduleById(db: Querier, id: string): Promise<CronSchedule | null> {
    const result = await db.query<CronScheduleRow>(
      sql`
        SELECT
          id, queue_name, interval_seconds, payload, workspace_id,
          next_tick_needed_at, enabled, created_at, updated_at
        FROM cron_schedules
        WHERE id = ${id}
      `
    )

    return result.rows[0] ? mapRowToSchedule(result.rows[0]) : null
  },

  /**
   * Get schedule by queue name and workspace ID.
   * Used for find-or-create pattern to prevent duplicates.
   */
  async getScheduleByQueueAndWorkspace(
    db: Querier,
    queueName: string,
    workspaceId: string | null
  ): Promise<CronSchedule | null> {
    const result = await db.query<CronScheduleRow>(
      sql`
        SELECT
          id, queue_name, interval_seconds, payload, workspace_id,
          next_tick_needed_at, enabled, created_at, updated_at
        FROM cron_schedules
        WHERE queue_name = ${queueName}
          AND workspace_id IS NOT DISTINCT FROM ${workspaceId}
      `
    )

    return result.rows[0] ? mapRowToSchedule(result.rows[0]) : null
  },

  /**
   * Get tick by ID (for testing/debugging).
   */
  async getTickById(db: Querier, id: string): Promise<CronTick | null> {
    const result = await db.query<CronTickRow>(
      sql`
        SELECT
          id, schedule_id, queue_name, payload, workspace_id,
          execute_at, leased_at, leased_by, leased_until, created_at
        FROM cron_ticks
        WHERE id = ${id}
      `
    )

    return result.rows[0] ? mapRowToTick(result.rows[0]) : null
  },
}
