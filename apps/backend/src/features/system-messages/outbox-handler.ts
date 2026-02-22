import type { Pool } from "pg"
import { OutboxRepository } from "../../lib/outbox"
import type { BudgetAlertOutboxPayload, InvitationAcceptedOutboxPayload } from "../../lib/outbox"
import { logger } from "../../lib/logger"
import { CursorLock, ensureListenerFromLatest, type ProcessResult } from "../../lib/cursor-lock"
import { DebounceWithMaxWait } from "../../lib/debounce"
import type { OutboxHandler } from "../../lib/outbox"
import type { SystemMessageService } from "./service"

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
 * Converts outbox events into system messages posted to each member's system stream.
 * Listens for events like budget:alert and formats them as messages.
 */
export class SystemMessageOutboxHandler implements OutboxHandler {
  readonly listenerId = "system-messages"

  private readonly db: Pool
  private readonly systemMessageService: SystemMessageService
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, systemMessageService: SystemMessageService) {
    this.db = db
    this.systemMessageService = systemMessageService
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
      (err) => logger.error({ err, listenerId: this.listenerId }, "SystemMessageOutboxHandler debouncer error")
    )
  }

  async ensureListener(): Promise<void> {
    await ensureListenerFromLatest(this.db, this.listenerId)
  }

  handle(): void {
    this.debouncer.trigger()
  }

  private async processEvents(): Promise<void> {
    await this.cursorLock.run(async (cursor, processedIds): Promise<ProcessResult> => {
      const events = await OutboxRepository.fetchAfterId(this.db, cursor, this.batchSize, processedIds)

      if (events.length === 0) {
        return { status: "no_events" }
      }

      const seen: bigint[] = []

      try {
        for (const event of events) {
          if (event.eventType === "budget:alert") {
            await this.handleBudgetAlert(event.payload as BudgetAlertOutboxPayload)
          } else if (event.eventType === "invitation:accepted") {
            await this.handleInvitationAccepted(event.payload as InvitationAcceptedOutboxPayload)
          }

          seen.push(event.id)
        }

        return { status: "processed", processedIds: seen }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))

        if (seen.length > 0) {
          return { status: "error", error, processedIds: seen }
        }

        return { status: "error", error }
      }
    })
  }

  private async handleBudgetAlert(payload: BudgetAlertOutboxPayload): Promise<void> {
    await this.systemMessageService.sendBudgetAlert(payload)

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

  private async handleInvitationAccepted(payload: InvitationAcceptedOutboxPayload): Promise<void> {
    await this.systemMessageService.sendInvitationAccepted(payload)

    logger.info(
      {
        workspaceId: payload.workspaceId,
        invitationId: payload.invitationId,
        workosUserId: payload.workosUserId,
      },
      "Invitation accepted notification sent to inviter"
    )
  }
}
