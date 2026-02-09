import type { Pool } from "pg"
import { Ticker } from "./ticker"
import { CronRepository } from "./cron-repository"
import { logger } from "../logger"

export interface CleanupWorkerConfig {
  intervalMs: number // How often to run cleanup (default: 300000 = 5 minutes)
  expiredThresholdMs: number // How old expired ticks must be before deletion (default: 300000 = 5 minutes)
}

const DEFAULT_CONFIG: CleanupWorkerConfig = {
  intervalMs: 300000, // 5 minutes
  expiredThresholdMs: 300000, // 5 minutes
}

/**
 * CleanupWorker - Removes expired and orphaned cron ticks
 *
 * Runs periodically (default: every 5 minutes) to clean up:
 * 1. Expired ticks - ticks whose lease expired without completion (failed executions)
 * 2. Orphaned ticks - ticks whose schedule was deleted
 *
 * This prevents the cron_ticks table from growing unbounded due to failures.
 *
 * See docs/distributed-cron-design.md for full design.
 */
export class CleanupWorker {
  private readonly ticker: Ticker
  private readonly config: CleanupWorkerConfig

  constructor(
    private readonly pool: Pool,
    config: Partial<CleanupWorkerConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.ticker = new Ticker({
      name: "cron-cleanup",
      intervalMs: this.config.intervalMs,
      maxConcurrency: 1,
    })
  }

  /**
   * Start cleanup worker.
   */
  start(): void {
    this.ticker.start(() => this.cleanup())
    logger.info(
      {
        intervalMs: this.config.intervalMs,
        expiredThresholdMs: this.config.expiredThresholdMs,
      },
      "CleanupWorker started"
    )
  }

  /**
   * Stop cleanup worker and wait for in-flight work to complete.
   */
  async stop(): Promise<void> {
    this.ticker.stop()
    await this.ticker.drain()
    logger.info("CleanupWorker stopped")
  }

  /**
   * Clean up expired and orphaned ticks.
   */
  private async cleanup(): Promise<void> {
    try {
      const expiredBefore = new Date(Date.now() - this.config.expiredThresholdMs)

      // Delete ticks that failed and lease expired
      const expiredCount = await CronRepository.deleteExpiredTicks(this.pool, {
        expiredBefore,
      })

      // Delete orphaned ticks (schedule was deleted)
      const orphanedCount = await CronRepository.deleteOrphanedTicks(this.pool)

      if (expiredCount > 0 || orphanedCount > 0) {
        logger.info({ expiredCount, orphanedCount }, "Cleaned up cron ticks")
      }
    } catch (err) {
      logger.error({ err }, "Failed to clean up cron ticks")
    }
  }

  /**
   * Check if ticker is running.
   */
  isRunning(): boolean {
    return this.ticker.isRunning()
  }
}
