import type { Pool } from "pg"
import { Ticker } from "./ticker"
import { CronRepository } from "./cron-repository"
import { logger } from "../logger"

export interface ScheduleManagerConfig {
  lookaheadSeconds: number // How far ahead to generate ticks (default: 60)
  intervalMs: number // How often to run (default: 10000 = 10s)
  batchSize: number // Max schedules to process per run (default: 100)
}

const DEFAULT_CONFIG: ScheduleManagerConfig = {
  lookaheadSeconds: 60,
  intervalMs: 10000,
  batchSize: 100,
}

/**
 * ScheduleManager - Generates cron ticks for upcoming schedule executions
 *
 * Runs periodically (default: every 10s) to pre-generate tick tokens for
 * schedules whose next execution is within the lookahead window (default: 60s).
 *
 * This two-phase approach (tick generation + tick execution) avoids polling
 * all schedules every 100ms. Instead:
 * - ScheduleManager runs infrequently (10s) to create future ticks
 * - QueueManager's existing ticker (100ms) discovers and executes due ticks
 *
 * See docs/distributed-cron-design.md for full design.
 */
export class ScheduleManager {
  private readonly ticker: Ticker
  private readonly config: ScheduleManagerConfig

  constructor(
    private readonly pool: Pool,
    config: Partial<ScheduleManagerConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.ticker = new Ticker({
      name: "schedule-manager",
      intervalMs: this.config.intervalMs,
      maxConcurrency: 1,
    })
  }

  /**
   * Start generating ticks for cron schedules.
   */
  start(): void {
    this.ticker.start(() => this.generateTicks())
    logger.info(
      {
        lookaheadSeconds: this.config.lookaheadSeconds,
        intervalMs: this.config.intervalMs,
        batchSize: this.config.batchSize,
      },
      "ScheduleManager started"
    )
  }

  /**
   * Stop generating ticks and wait for in-flight work to complete.
   */
  async stop(): Promise<void> {
    this.ticker.stop()
    await this.ticker.drain()
    logger.info("ScheduleManager stopped")
  }

  /**
   * Generate ticks for schedules that need execution soon.
   *
   * Queries schedules with next_tick_needed_at <= NOW + lookahead,
   * creates tick tokens at deterministic execution timestamps,
   * and updates each schedule's next_tick_needed_at.
   */
  private async generateTicks(): Promise<void> {
    try {
      // Find schedules needing tick generation in configured lookahead window
      const schedules = await CronRepository.findSchedulesNeedingTicks(this.pool, {
        lookaheadSeconds: this.config.lookaheadSeconds,
        limit: this.config.batchSize,
      })

      if (schedules.length === 0) {
        return
      }

      // Convert to createTicks format with deterministic executeAt values.
      // This preserves one canonical tick per schedule interval across all nodes.
      const ticksToCreate = schedules.map((schedule) => {
        return {
          scheduleId: schedule.id,
          queueName: schedule.queueName,
          payload: schedule.payload,
          workspaceId: schedule.workspaceId,
          executeAt: schedule.nextTickNeededAt,
          intervalSeconds: schedule.intervalSeconds,
        }
      })

      // Create tick tokens
      const ticks = await CronRepository.createTicks(this.pool, {
        schedules: ticksToCreate,
      })

      logger.debug(
        {
          schedulesProcessed: schedules.length,
          ticksCreated: ticks.length,
          lookaheadSeconds: this.config.lookaheadSeconds,
        },
        "Generated cron ticks"
      )
    } catch (err) {
      logger.error({ err }, "Failed to generate cron ticks")
    }
  }

  /**
   * Check if ticker is running.
   */
  isRunning(): boolean {
    return this.ticker.isRunning()
  }
}
