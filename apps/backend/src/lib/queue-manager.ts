import type { Pool } from "pg"
import pLimit from "p-limit"
import type { QueueRepository } from "../repositories/queue-repository"
import type { TokenPoolRepository } from "../repositories/token-pool-repository"
import { Ticker } from "./ticker"
import { calculateBackoffMs } from "./backoff"
import { logger } from "./logger"
import type { JobDataMap, JobQueueName, JobHandler } from "./job-queue"
import { queueId, workerId, tickerId } from "./id"

/**
 * Configuration for QueueManager
 */
export interface QueueManagerConfig {
  pool: Pool
  queueRepository: typeof QueueRepository
  tokenPoolRepository: typeof TokenPoolRepository

  // Queue processing config
  lockDurationMs?: number // Default 10000 (10s)
  refreshIntervalMs?: number // Default 5000 (5s)
  maxRetries?: number // Default 5
  baseBackoffMs?: number // Default 500
  scalingThreshold?: number // Default 50 (TODO: implement chunking)
  tokenBatchSize?: number // Default 10 (tokens to lease per tick)
  claimBatchSize?: number // Default 20 (messages to claim per token)
  processingConcurrency?: number // Default 5 (parallel message processing per worker)

  // Ticker config
  tickIntervalMs?: number // Default 100 (tick every 100ms)
  maxConcurrency?: number // Default 10 (max parallel workers)
}

const DEFAULT_CONFIG = {
  lockDurationMs: 10000,
  refreshIntervalMs: 5000,
  maxRetries: 5,
  baseBackoffMs: 500,
  scalingThreshold: 50,
  tokenBatchSize: 10,
  claimBatchSize: 20,
  processingConcurrency: 5,
  tickIntervalMs: 100,
  maxConcurrency: 10,
}

/**
 * Custom PostgreSQL queue system that replaces pg-boss.
 *
 * Provides:
 * - High-throughput parallel processing via workspace sharding
 * - Fair scheduling (prevents workspace starvation)
 * - Time-based locks with background refresh
 * - No connection pool exhaustion
 */
export class QueueManager {
  private readonly pool: Pool
  private readonly queueRepo: typeof QueueRepository
  private readonly tokenPoolRepo: typeof TokenPoolRepository
  private readonly lockDurationMs: number
  private readonly refreshIntervalMs: number
  private readonly maxRetries: number
  private readonly baseBackoffMs: number
  private readonly scalingThreshold: number
  private readonly tokenBatchSize: number
  private readonly claimBatchSize: number
  private readonly processingConcurrency: number
  private readonly handlers = new Map<string, JobHandler<unknown>>()
  private readonly ticker: Ticker
  private readonly tickerId: string
  private isStarted = false
  private isStopping = false

  // Track active workers for graceful shutdown
  private readonly activeWorkers = new Set<Promise<void>>()

  // Track scheduled jobs
  private readonly scheduledJobs = new Map<string, Timer>()

  constructor(config: QueueManagerConfig) {
    const {
      pool,
      queueRepository,
      tokenPoolRepository,
      lockDurationMs = DEFAULT_CONFIG.lockDurationMs,
      refreshIntervalMs = DEFAULT_CONFIG.refreshIntervalMs,
      maxRetries = DEFAULT_CONFIG.maxRetries,
      baseBackoffMs = DEFAULT_CONFIG.baseBackoffMs,
      scalingThreshold = DEFAULT_CONFIG.scalingThreshold,
      tokenBatchSize = DEFAULT_CONFIG.tokenBatchSize,
      claimBatchSize = DEFAULT_CONFIG.claimBatchSize,
      processingConcurrency = DEFAULT_CONFIG.processingConcurrency,
      tickIntervalMs = DEFAULT_CONFIG.tickIntervalMs,
      maxConcurrency = DEFAULT_CONFIG.maxConcurrency,
    } = config

    this.pool = pool
    this.queueRepo = queueRepository
    this.tokenPoolRepo = tokenPoolRepository
    this.lockDurationMs = lockDurationMs
    this.refreshIntervalMs = refreshIntervalMs
    this.maxRetries = maxRetries
    this.baseBackoffMs = baseBackoffMs
    this.scalingThreshold = scalingThreshold
    this.tokenBatchSize = tokenBatchSize
    this.claimBatchSize = claimBatchSize
    this.processingConcurrency = processingConcurrency

    this.tickerId = tickerId()
    this.ticker = new Ticker({
      name: "queue-manager",
      intervalMs: tickIntervalMs,
      maxConcurrency,
    })
  }

  /**
   * Register handler for a queue.
   * Must be called before start().
   */
  registerHandler<T extends JobQueueName>(queueName: T, handler: JobHandler<JobDataMap[T]>): void {
    if (this.isStarted) {
      throw new Error(`Cannot register handler for ${queueName}: queue already started`)
    }
    this.handlers.set(queueName, handler as JobHandler<unknown>)
  }

  /**
   * Schedule a recurring job.
   * Simple replacement for pg-boss schedule() using setInterval.
   *
   * @param queueName - Queue to send messages to
   * @param intervalSeconds - Interval in seconds between job runs
   * @param data - Job data to send
   */
  schedule<T extends JobQueueName>(queueName: T, intervalSeconds: number, data: JobDataMap[T]): void {
    if (this.scheduledJobs.has(queueName)) {
      throw new Error(`Job ${queueName} is already scheduled`)
    }

    const timer = setInterval(async () => {
      try {
        await this.send(queueName, data)
        logger.debug({ queueName }, "Scheduled job sent")
      } catch (err) {
        logger.error({ queueName, err }, "Failed to send scheduled job")
      }
    }, intervalSeconds * 1000)

    this.scheduledJobs.set(queueName, timer)

    logger.info({ queueName, intervalSeconds }, "Job scheduled")
  }

  /**
   * Send message to queue.
   * Returns message ID.
   */
  async send<T extends JobQueueName>(
    queueName: T,
    data: JobDataMap[T],
    options?: { processAfter?: Date }
  ): Promise<string> {
    // Extract workspaceId from job data
    const workspaceId = this.extractWorkspaceId(queueName, data)

    const messageId = queueId()
    const now = new Date()
    const processAfter = options?.processAfter ?? now

    await this.queueRepo.insert(this.pool, {
      id: messageId,
      queueName,
      workspaceId,
      payload: data,
      processAfter,
      insertedAt: now,
    })

    logger.debug({ queueName, messageId, workspaceId }, "Message sent to queue")

    return messageId
  }

  /**
   * Start processing.
   */
  start(): void {
    if (this.isStarted) {
      throw new Error("QueueManager already started")
    }

    this.isStarted = true
    this.ticker.start(() => this.onTick())

    logger.info("QueueManager started")
  }

  /**
   * Graceful shutdown.
   * 1. Stop ticker (no new work)
   * 2. Wait for in-flight work with timeout
   * 3. Close resources
   */
  async stop(): Promise<void> {
    if (this.isStopping) {
      return
    }

    this.isStopping = true
    logger.info("QueueManager stopping...")

    // Stop scheduled jobs
    for (const [queueName, timer] of this.scheduledJobs) {
      clearInterval(timer)
      logger.debug({ queueName }, "Scheduled job stopped")
    }
    this.scheduledJobs.clear()

    // Stop ticker (no new work)
    this.ticker.stop()

    // Wait for in-flight ticker callbacks
    await this.ticker.drain()

    // Wait for active workers with timeout
    if (this.activeWorkers.size > 0) {
      logger.info({ activeWorkers: this.activeWorkers.size }, "Waiting for active workers to complete")

      const timeout = new Promise((resolve) => setTimeout(resolve, 30000))
      const allWorkers = Promise.all(Array.from(this.activeWorkers))

      await Promise.race([allWorkers, timeout])

      if (this.activeWorkers.size > 0) {
        logger.warn({ remainingWorkers: this.activeWorkers.size }, "Some workers did not complete within timeout")
      }
    }

    logger.info("QueueManager stopped")
  }

  /**
   * Called on each ticker interval.
   * Batch leases tokens and spawns workers.
   */
  private async onTick(): Promise<void> {
    if (this.isStopping) {
      return
    }

    const now = new Date()

    // 1. Batch lease tokens for available (queue, workspace) pairs
    // Only lease tokens for queues we have handlers for
    const queueNames = Array.from(this.handlers.keys())
    if (queueNames.length === 0) {
      return // No handlers registered
    }

    const tokens = await this.tokenPoolRepo.batchLeaseTokens(this.pool, {
      leasedBy: this.tickerId,
      leasedAt: now,
      leasedUntil: new Date(now.getTime() + this.lockDurationMs),
      now,
      limit: this.tokenBatchSize,
      queueNames,
    })

    if (tokens.length === 0) {
      return // No work available
    }

    logger.debug({ tokenCount: tokens.length }, "Leased tokens")

    // 2. For each token, spawn worker in parallel
    const workers = tokens.map((token) => this.processToken(token))
    await Promise.all(workers)
  }

  /**
   * Process messages for a token.
   *
   * Optimized for throughput:
   * 1. Batch claim messages upfront (1 query instead of N)
   * 2. Process with controlled concurrency (processingConcurrency at a time)
   * 3. Background renewal for both token AND messages (prevents expiration during long-running work)
   * 4. Complete messages immediately (no batching - good for observability)
   */
  private async processToken(token: { id: string; queueName: string; workspaceId: string }): Promise<void> {
    const workerIdValue = workerId()
    const workerPromise = (async () => {
      // Set up token renewal timer (runs for entire worker lifetime)
      let tokenRenewalInProgress = false
      const tokenRenewTimer = setInterval(async () => {
        if (tokenRenewalInProgress) {
          logger.debug({ tokenId: token.id }, "Skipping token renewal - previous renewal still in progress")
          return
        }

        tokenRenewalInProgress = true
        try {
          const renewed = await this.renewTokenLease(token.id)
          if (!renewed) {
            logger.warn({ tokenId: token.id }, "Failed to renew token lease - may have been taken by another worker")
          } else {
            logger.debug({ tokenId: token.id }, "Token lease renewed")
          }
        } catch (err) {
          logger.warn({ tokenId: token.id, err }, "Failed to renew token lease")
        } finally {
          tokenRenewalInProgress = false
        }
      }, this.refreshIntervalMs)

      try {
        const now = new Date()

        // 1. Batch claim messages upfront
        const messages = await this.queueRepo.batchClaimMessages(this.pool, {
          queueName: token.queueName,
          workspaceId: token.workspaceId,
          claimedBy: workerIdValue,
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + this.lockDurationMs),
          now,
          limit: this.claimBatchSize,
        })

        if (messages.length === 0) {
          return // No work for this token
        }

        logger.debug(
          { messageCount: messages.length, queueName: token.queueName, workspaceId: token.workspaceId },
          "Batch claimed messages"
        )

        // 2. Set up message renewal timer for ALL messages
        const messageIds = messages.map((m) => m.id)
        let messageRenewalInProgress = false

        const messageRenewTimer = setInterval(async () => {
          if (messageRenewalInProgress) {
            logger.debug({ messageIds }, "Skipping batch renewal - previous renewal still in progress")
            return
          }

          messageRenewalInProgress = true
          try {
            const renewed = await this.batchRenewClaims(messageIds, workerIdValue)
            logger.debug({ renewedCount: renewed, totalMessages: messageIds.length }, "Batch renewed claims")
          } catch (err) {
            logger.warn({ messageIds, err }, "Failed to batch renew claims")
          } finally {
            messageRenewalInProgress = false
          }
        }, this.refreshIntervalMs)

        try {
          // 3. Process with controlled concurrency (processingConcurrency at a time)
          const limit = pLimit(this.processingConcurrency)

          await Promise.all(
            messages.map((message) =>
              limit(async () => {
                try {
                  await this.processMessage(message, workerIdValue)
                } catch (err) {
                  // Error already logged and handled in processMessage
                  // Continue processing other messages
                }
              })
            )
          )
        } finally {
          clearInterval(messageRenewTimer)
        }
      } finally {
        clearInterval(tokenRenewTimer)
        // Always release token
        await this.releaseToken(token.id)
      }
    })()

    this.activeWorkers.add(workerPromise)
    workerPromise.finally(() => {
      this.activeWorkers.delete(workerPromise)
    })

    await workerPromise
  }

  /**
   * Renew token lease.
   * Returns false if lease lost.
   */
  private async renewTokenLease(tokenId: string): Promise<boolean> {
    const now = new Date()

    return await this.tokenPoolRepo.renewLease(this.pool, {
      tokenId,
      leasedBy: this.tickerId,
      leasedUntil: new Date(now.getTime() + this.lockDurationMs),
    })
  }

  /**
   * Batch renew claims for multiple messages.
   */
  private async batchRenewClaims(messageIds: string[], workerId: string): Promise<number> {
    const now = new Date()

    return await this.queueRepo.batchRenewClaims(this.pool, {
      messageIds,
      claimedBy: workerId,
      claimedUntil: new Date(now.getTime() + this.lockDurationMs),
    })
  }

  /**
   * Process a single message.
   *
   * Note: Renewal is handled at the batch level by processToken(),
   * not per-message, to reduce database queries.
   */
  private async processMessage(
    message: { id: string; queueName: string; payload: unknown; failedCount: number },
    workerId: string
  ): Promise<void> {
    const handler = this.handlers.get(message.queueName)

    if (!handler) {
      // This should NEVER happen - we only lease tokens for queues with registered handlers.
      // If this occurs, it's a bug in the token leasing logic.
      throw new Error(
        `CRITICAL BUG: No handler registered for queue ${message.queueName}. ` +
          `This should never happen as we filter tokens by registered handlers. ` +
          `Registered queues: ${Array.from(this.handlers.keys()).join(", ")}`
      )
    }

    try {
      // Execute handler - create minimal Job object compatible with pg-boss Job type
      await handler({
        id: message.id,
        name: message.queueName,
        data: message.payload,
        expireInSeconds: 0,
        signal: new AbortController().signal,
      })

      // Success - complete message
      await this.completeMessage(message.id, workerId)

      logger.debug({ messageId: message.id, queueName: message.queueName }, "Message completed")
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))

      logger.warn({ messageId: message.id, queueName: message.queueName, err: error }, "Message processing failed")

      // Calculate new failed_count
      const newFailedCount = message.failedCount + 1

      if (newFailedCount >= this.maxRetries) {
        // Move to DLQ
        await this.moveMessageToDlq(message.id, workerId, error.message)

        logger.error(
          { messageId: message.id, queueName: message.queueName },
          "Message moved to DLQ after exhausting retries"
        )
      } else {
        // Retry with backoff
        await this.retryMessage(message.id, workerId, error.message, newFailedCount)

        logger.debug(
          { messageId: message.id, queueName: message.queueName, retryCount: newFailedCount },
          "Message scheduled for retry"
        )
      }
    }
  }

  /**
   * Complete a message.
   */
  private async completeMessage(messageId: string, workerId: string): Promise<void> {
    const now = new Date()

    await this.queueRepo.complete(this.pool, {
      messageId,
      claimedBy: workerId,
      completedAt: now,
    })
  }

  /**
   * Retry a message with backoff.
   */
  private async retryMessage(
    messageId: string,
    workerId: string,
    error: string,
    newFailedCount: number
  ): Promise<void> {
    const now = new Date()
    const backoffMs = calculateBackoffMs({
      baseMs: this.baseBackoffMs,
      retryCount: newFailedCount,
    })

    await this.queueRepo.fail(this.pool, {
      messageId,
      claimedBy: workerId,
      error,
      processAfter: new Date(now.getTime() + backoffMs),
      now,
    })
  }

  /**
   * Move message to DLQ.
   */
  private async moveMessageToDlq(messageId: string, workerId: string, error: string): Promise<void> {
    const now = new Date()

    await this.queueRepo.failDlq(this.pool, {
      messageId,
      claimedBy: workerId,
      error,
      dlqAt: now,
    })
  }

  /**
   * Release a token.
   */
  private async releaseToken(tokenId: string): Promise<void> {
    await this.tokenPoolRepo.deleteToken(this.pool, {
      tokenId,
      leasedBy: this.tickerId,
    })
  }

  /**
   * Extract workspaceId from job data.
   * All job types must include workspaceId.
   */
  private extractWorkspaceId(queueName: string, data: unknown): string {
    const isObject = data !== null && typeof data === "object"
    const workspaceId = isObject ? (data as Record<string, unknown>).workspaceId : undefined

    if (typeof workspaceId !== "string" || workspaceId === "") {
      throw new Error(`Invalid job data for queue ${queueName}: missing or invalid workspaceId`)
    }

    return workspaceId
  }
}
