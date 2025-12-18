import { PgBoss, type Job, type SendOptions, type WorkHandler } from "pg-boss"
import type { Pool } from "pg"
import { withClient } from "../db"
import { logger } from "./logger"

/**
 * Job queue built on pg-boss for durable, retriable job execution.
 *
 * Why pg-boss instead of just the outbox pattern?
 * - Outbox is for event dispatch (low-latency, many listeners)
 * - pg-boss is for durable job execution (retries, persistence, long-running work)
 *
 * The companion flow uses both:
 * 1. Outbox listener triggers on message:created
 * 2. Listener dispatches a job to pg-boss
 * 3. pg-boss worker executes the agent (which can take 10-30+ seconds)
 */

// Job type definitions
export const JobQueues = {
  COMPANION_RESPOND: "companion.respond",
  NAMING_GENERATE: "naming.generate",
} as const

export type JobQueueName = (typeof JobQueues)[keyof typeof JobQueues]

export interface CompanionJobData {
  streamId: string
  messageId: string
  triggeredBy: string
}

export interface NamingJobData {
  streamId: string
}

// Map queue names to their data types
export interface JobDataMap {
  [JobQueues.COMPANION_RESPOND]: CompanionJobData
  [JobQueues.NAMING_GENERATE]: NamingJobData
}

// Default options for companion jobs
const COMPANION_JOB_OPTIONS: SendOptions = {
  retryLimit: 3,
  retryDelay: 5,
  retryBackoff: true,
}

/**
 * Handler for a single job. Returns void on success, throws on error.
 */
export type JobHandler<T> = (job: Job<T>) => Promise<void>

/**
 * Wrapper around pg-boss that provides typed job helpers.
 */
export class JobQueueManager {
  private boss: PgBoss
  private handlers = new Map<string, JobHandler<unknown>>()

  constructor(pool: Pool) {
    this.boss = new PgBoss({
      db: {
        executeSql: async (text: string, values?: unknown[]) => {
          const result = await withClient(pool, (client) => client.query(text, values as unknown[]))
          return { rows: result.rows }
        },
      },
      schema: "pgboss",
    })
  }

  async start(): Promise<void> {
    await this.boss.start()
    logger.info("Job queue started")

    // Register all handlers after start
    for (const [queue, handler] of this.handlers) {
      // Ensure queue exists before polling
      await this.boss.createQueue(queue)

      // pg-boss passes an array of jobs; we process them sequentially
      await this.boss.work(queue, async (jobs: Job<unknown>[]) => {
        for (const job of jobs) {
          await handler(job)
        }
      })
      logger.info({ queue }, "Job handler registered")
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30000 })
    logger.info("Job queue stopped")
  }

  /**
   * Register a handler for a job queue. Must be called before start().
   */
  registerHandler<T extends JobQueueName>(queue: T, handler: JobHandler<JobDataMap[T]>): void {
    this.handlers.set(queue, handler as JobHandler<unknown>)
  }

  /**
   * Send a job to the queue.
   */
  async send<T extends JobQueueName>(queue: T, data: JobDataMap[T], options?: SendOptions): Promise<string | null> {
    const mergedOptions = { ...COMPANION_JOB_OPTIONS, ...options }
    const jobId = await this.boss.send(queue, data, mergedOptions)
    logger.debug({ queue, jobId, data }, "Job sent")
    return jobId
  }

  /**
   * Get the underlying pg-boss instance for advanced operations.
   */
  getBoss(): PgBoss {
    return this.boss
  }
}

/**
 * Create a job queue instance. The queue must be started with start() before use.
 */
export function createJobQueue(pool: Pool): JobQueueManager {
  return new JobQueueManager(pool)
}

// Re-export useful types
export type { Job, SendOptions }
