import type { Pool } from "pg"
import { OutboxRepository, type ActivityCreatedOutboxPayload, type StreamReadOutboxPayload } from "../../lib/outbox"
import type { PushService } from "./service"
import { logger } from "../../lib/logger"
import { CursorLock, ensureListenerFromLatest, DebounceWithMaxWait, type ProcessResult } from "@threa/backend-common"
import type { OutboxHandler } from "../../lib/outbox"

const DEFAULT_CONFIG = {
  // Smaller batch than other outbox handlers: each event triggers external HTTP calls
  // (webpush.sendNotification) that hold the cursor lock during network I/O.
  batchSize: 10,
  debounceMs: 50,
  maxWaitMs: 200,
  lockDurationMs: 10_000,
  refreshIntervalMs: 5_000,
  maxRetries: 5,
  baseBackoffMs: 1_000,
}

interface PushNotificationHandlerDeps {
  pool: Pool
  pushService: PushService
}

/**
 * Listens for outbox events and delegates push delivery to PushService.
 * Handles activity:created (show notification) and stream:read (clear notifications).
 * Infrastructure-only: cursor management, batching, and error handling (INV-34).
 */
export class PushNotificationHandler implements OutboxHandler {
  readonly listenerId = "push-notifications"

  private readonly db: Pool
  private readonly pushService: PushService
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(deps: PushNotificationHandlerDeps) {
    this.db = deps.pool
    this.pushService = deps.pushService
    this.batchSize = DEFAULT_CONFIG.batchSize

    this.cursorLock = new CursorLock({
      pool: deps.pool,
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
      (err) => logger.error({ err, listenerId: this.listenerId }, "PushNotificationHandler debouncer error")
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
          if (event.eventType === "activity:created") {
            const payload = event.payload as ActivityCreatedOutboxPayload
            if (!payload?.workspaceId || !payload?.targetUserId || !payload?.activity) {
              logger.warn({ eventId: event.id }, "Skipping malformed activity:created payload")
              seen.push(event.id)
              continue
            }
            await this.pushService.deliverPushForActivity(payload)
          } else if (event.eventType === "stream:read") {
            const payload = event.payload as StreamReadOutboxPayload
            if (!payload?.workspaceId || !payload?.authorId || !payload?.streamId) {
              logger.warn({ eventId: event.id }, "Skipping malformed stream:read payload")
              seen.push(event.id)
              continue
            }
            await this.pushService.deliverClearForStream(payload.workspaceId, payload.authorId, payload.streamId)
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
}
