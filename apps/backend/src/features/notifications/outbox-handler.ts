import type { Pool } from "pg"
import { OutboxRepository } from "../../lib/outbox"
import type { BudgetAlertOutboxPayload } from "../../lib/outbox"
import { logger } from "../../lib/logger"
import { CursorLock, ensureListenerFromLatest, type ProcessResult } from "../../lib/cursor-lock"
import { DebounceWithMaxWait } from "../../lib/debounce"
import type { OutboxHandler } from "../../lib/outbox"
import type { NotificationService } from "./service"

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
 * Handler that converts system-level outbox events into user-visible notifications.
 * Listens for events like budget:alert and posts messages to each member's system stream.
 */
export class NotificationOutboxHandler implements OutboxHandler {
  readonly listenerId = "notifications"

  private readonly db: Pool
  private readonly notificationService: NotificationService
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, notificationService: NotificationService) {
    this.db = db
    this.notificationService = notificationService
    this.batchSize = DEFAULT_CONFIG.batchSize

    this.cursorLock = new CursorLock({
      pool: db,
      listenerId: this.listenerId,
      lockDurationMs: DEFAULT_CONFIG.lockDurationMs,
      refreshIntervalMs: DEFAULT_CONFIG.refreshIntervalMs,
      maxRetries: DEFAULT_CONFIG.maxRetries,
      baseBackoffMs: DEFAULT_CONFIG.baseBackoffMs,
      batchSize: this.batchSize,
    })

    this.debouncer = new DebounceWithMaxWait(
      () => this.processEvents(),
      DEFAULT_CONFIG.debounceMs,
      DEFAULT_CONFIG.maxWaitMs,
      (err) => logger.error({ err, listenerId: this.listenerId }, "NotificationOutboxHandler debouncer error")
    )
  }

  async ensureListener(): Promise<void> {
    await ensureListenerFromLatest(this.db, this.listenerId)
  }

  handle(): void {
    this.debouncer.trigger()
  }

  private async processEvents(): Promise<void> {
    await this.cursorLock.run(async (cursor): Promise<ProcessResult> => {
      const events = await OutboxRepository.fetchAfterId(this.db, cursor, this.batchSize)

      if (events.length === 0) {
        return { status: "no_events" }
      }

      let lastProcessedId = cursor

      try {
        for (const event of events) {
          if (event.eventType === "budget:alert") {
            await this.handleBudgetAlert(event.payload as BudgetAlertOutboxPayload)
          }

          lastProcessedId = event.id
        }

        return { status: "processed", newCursor: events[events.length - 1].id }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))

        if (lastProcessedId > cursor) {
          return { status: "error", error, newCursor: lastProcessedId }
        }

        return { status: "error", error }
      }
    })
  }

  private async handleBudgetAlert(payload: BudgetAlertOutboxPayload): Promise<void> {
    await this.notificationService.sendBudgetAlert(payload)

    logger.info(
      {
        workspaceId: payload.workspaceId,
        percentUsed: payload.percentUsed,
        budgetUsd: payload.budgetUsd,
        currentUsageUsd: payload.currentUsageUsd,
      },
      "Budget alert notification sent to workspace"
    )
  }
}
