import type { Pool } from "pg"
import { Ticker } from "../queue/ticker"
import { logger } from "../logger"
import { OutboxRepository } from "./repository"

export interface OutboxRetentionWorkerConfig {
  listenerIds: string[]
  intervalMs: number
  retentionMs: number
  batchSize: number
  maxBatchesPerRun: number
}

const DEFAULT_CONFIG: Omit<OutboxRetentionWorkerConfig, "listenerIds"> = {
  intervalMs: 300000,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  batchSize: 1000,
  maxBatchesPerRun: 10,
}

/**
 * Periodically purges outbox rows that are:
 * 1) Older than retention window, and
 * 2) At or below the minimum listener cursor.
 */
export class OutboxRetentionWorker {
  private readonly ticker: Ticker
  private readonly config: OutboxRetentionWorkerConfig

  constructor(
    private readonly pool: Pool,
    config: Partial<Omit<OutboxRetentionWorkerConfig, "listenerIds">> & Pick<OutboxRetentionWorkerConfig, "listenerIds">
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      listenerIds: [...new Set(config.listenerIds)],
    }

    if (this.config.listenerIds.length === 0) {
      throw new Error("OutboxRetentionWorker requires at least one listener ID")
    }

    if (this.config.intervalMs <= 0) {
      throw new Error(`OutboxRetentionWorker intervalMs must be > 0, got ${this.config.intervalMs}`)
    }

    if (this.config.retentionMs <= 0) {
      throw new Error(`OutboxRetentionWorker retentionMs must be > 0, got ${this.config.retentionMs}`)
    }

    if (this.config.batchSize <= 0) {
      throw new Error(`OutboxRetentionWorker batchSize must be > 0, got ${this.config.batchSize}`)
    }

    if (this.config.maxBatchesPerRun <= 0) {
      throw new Error(`OutboxRetentionWorker maxBatchesPerRun must be > 0, got ${this.config.maxBatchesPerRun}`)
    }

    this.ticker = new Ticker({
      name: "outbox-retention",
      intervalMs: this.config.intervalMs,
      maxConcurrency: 1,
    })
  }

  start(): void {
    this.ticker.start(() => this.cleanup())
    logger.info(
      {
        intervalMs: this.config.intervalMs,
        retentionMs: this.config.retentionMs,
        batchSize: this.config.batchSize,
        maxBatchesPerRun: this.config.maxBatchesPerRun,
        listenerIds: this.config.listenerIds,
      },
      "OutboxRetentionWorker started"
    )
  }

  async stop(): Promise<void> {
    this.ticker.stop()
    await this.ticker.drain()
    logger.info("OutboxRetentionWorker stopped")
  }

  isRunning(): boolean {
    return this.ticker.isRunning()
  }

  private async cleanup(): Promise<void> {
    try {
      const retentionCutoff = new Date(Date.now() - this.config.retentionMs)
      const watermark = await OutboxRepository.getRetentionWatermark(this.pool, this.config.listenerIds)

      if (watermark === null || watermark <= 0n) {
        return
      }

      let totalDeleted = 0
      let batches = 0

      while (batches < this.config.maxBatchesPerRun) {
        const deleted = await OutboxRepository.deleteRetainedEvents(this.pool, {
          maxEventId: watermark,
          createdBefore: retentionCutoff,
          limit: this.config.batchSize,
        })

        if (deleted === 0) {
          break
        }

        totalDeleted += deleted
        batches += 1

        if (deleted < this.config.batchSize) {
          break
        }
      }

      if (totalDeleted > 0) {
        logger.info(
          {
            deleted: totalDeleted,
            batches,
            watermark: watermark.toString(),
            retentionCutoff: retentionCutoff.toISOString(),
          },
          "Outbox retention cleanup completed"
        )
      }
    } catch (err) {
      logger.error({ err }, "Outbox retention cleanup failed")
    }
  }
}
