import type { Pool } from "pg"
import {
  OutboxRepository,
  type ActivityCreatedOutboxPayload,
  type OutboxEvent,
  type StreamReadOutboxPayload,
  type StreamsReadAllOutboxPayload,
} from "../../lib/outbox"
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

      // Sequential delivery within the batch. Parallel delivery is tempting but
      // unsafe with CursorLock's sliding-window compaction: if event 8 fails but
      // events 9-10 succeed and are added to processedIds, the gap window can
      // expire during retry backoff, causing the cursor to jump past event 8 and
      // permanently lose it. Sequential stops at the first failure, ensuring the
      // cursor never advances past un-delivered events.
      //
      // Push events are low-volume (activity:created, stream:read) so sequential
      // within a batch of 10 has negligible latency impact — the real throughput
      // win is the dedicated realtime pool isolating push from background workers.
      //
      // Per-device webpush failures are handled inside PushService (stale
      // subscription eviction) and don't escape as thrown errors here.
      const seen: bigint[] = []

      try {
        for (const event of events) {
          await this.deliverEvent(event)
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

  private async deliverEvent(event: OutboxEvent): Promise<void> {
    if (event.eventType === "activity:created") {
      const payload = event.payload as ActivityCreatedOutboxPayload
      if (!payload?.workspaceId || !payload?.targetUserId || !payload?.activity) {
        logger.warn({ eventId: event.id }, "Skipping malformed activity:created payload")
        return
      }
      await this.pushService.deliverPushForActivity(payload)
      return
    }

    if (event.eventType === "stream:read") {
      const payload = event.payload as StreamReadOutboxPayload
      if (!payload?.workspaceId || !payload?.authorId || !payload?.streamId) {
        logger.warn({ eventId: event.id }, "Skipping malformed stream:read payload")
        return
      }
      await this.pushService.deliverClearForStream(payload.workspaceId, payload.authorId, payload.streamId)
      return
    }

    if (event.eventType === "stream:read_all") {
      const payload = event.payload as StreamsReadAllOutboxPayload
      if (!payload?.workspaceId || !payload?.authorId || !payload?.streamIds?.length) {
        logger.warn({ eventId: event.id }, "Skipping malformed stream:read_all payload")
        return
      }
      await this.pushService.deliverClearForStreams(payload.workspaceId, payload.authorId, payload.streamIds)
    }
  }
}
