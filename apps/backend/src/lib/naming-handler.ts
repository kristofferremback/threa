import type { Pool } from "pg"
import { OutboxRepository } from "../repositories"
import { StreamRepository } from "../repositories/stream-repository"
import { parseMessageCreatedPayload } from "./outbox-payload-parsers"
import { needsAutoNaming } from "./display-name"
import { logger } from "./logger"
import { AuthorTypes } from "@threa/types"
import { JobQueues } from "./job-queue"
import type { QueueManager } from "./queue-manager"
import { CursorLock, ensureListenerFromLatest, type ProcessResult } from "./cursor-lock"
import { DebounceWithMaxWait } from "./debounce"
import type { OutboxHandler } from "./outbox-dispatcher"

export interface NamingHandlerConfig {
  batchSize?: number
  debounceMs?: number
  maxWaitMs?: number
  lockDurationMs?: number
  refreshIntervalMs?: number
  maxRetries?: number
  baseBackoffMs?: number
}

const DEFAULT_CONFIG = {
  batchSize: 100,
  debounceMs: 50,
  maxWaitMs: 200,
  lockDurationMs: 10_000,
  refreshIntervalMs: 5_000,
  maxRetries: 5,
  baseBackoffMs: 1_000,
}

/**
 * Handler that dispatches auto-naming jobs for messages in streams
 * that need display name generation.
 *
 * Triggers LLM processing for:
 * - Scratchpads without a generated name
 * - Threads without a generated name
 *
 * Uses time-based cursor locking for exclusive access without
 * holding database connections during processing.
 */
export class NamingHandler implements OutboxHandler {
  readonly listenerId = "naming"

  private readonly db: Pool
  private readonly jobQueue: QueueManager
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, jobQueue: QueueManager, config?: NamingHandlerConfig) {
    this.db = db
    this.jobQueue = jobQueue
    this.batchSize = config?.batchSize ?? DEFAULT_CONFIG.batchSize

    this.cursorLock = new CursorLock({
      pool: db,
      listenerId: this.listenerId,
      lockDurationMs: config?.lockDurationMs ?? DEFAULT_CONFIG.lockDurationMs,
      refreshIntervalMs: config?.refreshIntervalMs ?? DEFAULT_CONFIG.refreshIntervalMs,
      maxRetries: config?.maxRetries ?? DEFAULT_CONFIG.maxRetries,
      baseBackoffMs: config?.baseBackoffMs ?? DEFAULT_CONFIG.baseBackoffMs,
      batchSize: this.batchSize,
    })

    this.debouncer = new DebounceWithMaxWait(
      () => this.processEvents(),
      config?.debounceMs ?? DEFAULT_CONFIG.debounceMs,
      config?.maxWaitMs ?? DEFAULT_CONFIG.maxWaitMs,
      (err) => logger.error({ err, listenerId: this.listenerId }, "NamingHandler debouncer error")
    )
  }

  /**
   * Ensures the listener exists in the database.
   * Call this during startup before registering with the dispatcher.
   */
  async ensureListener(): Promise<void> {
    await ensureListenerFromLatest(this.db, this.listenerId)
  }

  /**
   * Called by OutboxDispatcher on notification.
   * Debounces rapid notifications and processes events.
   */
  handle(): void {
    this.debouncer.trigger()
  }

  private async processEvents(): Promise<void> {
    await this.cursorLock.run(async (cursor): Promise<ProcessResult> => {
      // Fetch batch of events
      const events = await OutboxRepository.fetchAfterId(this.db, cursor, this.batchSize)

      if (events.length === 0) {
        return { status: "no_events" }
      }

      // Track last successfully processed event for partial progress
      let lastProcessedId = cursor

      try {
        for (const event of events) {
          // Only process message:created events
          if (event.eventType !== "message:created") {
            lastProcessedId = event.id
            continue
          }

          const payload = await parseMessageCreatedPayload(event.payload, this.db)
          if (!payload) {
            logger.debug({ eventId: event.id.toString() }, "NamingHandler: malformed event, skipping")
            lastProcessedId = event.id
            continue
          }

          const { streamId, event: messageEvent } = payload
          const isAgentMessage = messageEvent.actorType !== AuthorTypes.USER

          const stream = await StreamRepository.findById(this.db, streamId)
          if (!stream) {
            logger.warn({ streamId }, "NamingHandler: stream not found")
            lastProcessedId = event.id
            continue
          }

          if (!needsAutoNaming(stream)) {
            lastProcessedId = event.id
            continue
          }

          // Dispatch to queue
          await this.jobQueue.send(JobQueues.NAMING_GENERATE, {
            workspaceId: stream.workspaceId,
            streamId,
            requireName: isAgentMessage,
          })

          logger.info({ streamId, requireName: isAgentMessage }, "Naming job dispatched")
          lastProcessedId = event.id
        }

        return { status: "processed", newCursor: events[events.length - 1].id }
      } catch (err) {
        // Return partial progress if we processed some events
        const error = err instanceof Error ? err : new Error(String(err))

        if (lastProcessedId > cursor) {
          return { status: "error", error, newCursor: lastProcessedId }
        }

        return { status: "error", error }
      }
    })
  }
}
