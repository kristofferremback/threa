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

// Dead letter queue suffix - jobs that exhaust retries go here
const DEAD_LETTER_SUFFIX = "__dlq"

// Default options for jobs
const DEFAULT_JOB_OPTIONS: SendOptions = {
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
          // pg returns an array for multi-statement queries, pg-boss expects each element to have rows
          if (Array.isArray(result)) {
            return result.map((r) => ({ rows: r.rows }))
          }
          return { rows: result.rows }
        },
      },
      schema: "pgboss",
    })
  }

  async start(): Promise<void> {
    // Register event listeners before starting
    this.boss.on("error", (error) => {
      logger.error({ err: error }, "pg-boss error")
    })

    await this.boss.start()
    logger.info("Job queue started")

    // Register handlers for each queue
    for (const [queue, handler] of this.handlers) {
      const dlq = `${queue}${DEAD_LETTER_SUFFIX}`

      // Create dead letter queue first (must exist before referencing in deadLetter option)
      await this.boss.createQueue(dlq)

      // Create main queue with dead letter configuration
      await this.boss.createQueue(queue, { deadLetter: dlq })

      // pg-boss passes an array of jobs; we process them sequentially
      await this.boss.work(
        queue,
        {
          batchSize: 5, // Fetch up to 5 jobs per poll
          pollingIntervalSeconds: 1, // Poll every 1 second instead of default 2
        },
        async (jobs: Job<unknown>[]) => {
          for (const job of jobs) {
            try {
              await handler(job)
            } catch (error) {
              // Warn on failure - provides context when troubleshooting
              logger.warn({ jobId: job.id, queue, err: error }, "Job failed, will retry if attempts remain")
              throw error
            }
          }
        }
      )

      // Dead letter handler - alert level, these need attention
      await this.boss.work(dlq, async (jobs: Job<unknown>[]) => {
        for (const job of jobs) {
          logger.error(
            { jobId: job.id, queue: dlq, data: job.data },
            "Job moved to dead letter queue after exhausting retries"
          )
        }
      })

      logger.info({ queue, dlq }, "Job handler registered")
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
    const mergedOptions = { ...DEFAULT_JOB_OPTIONS, ...options }
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
