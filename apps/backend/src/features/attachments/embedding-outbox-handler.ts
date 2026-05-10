import type { Pool } from "pg"
import { logger } from "../../lib/logger"
import { JobQueues, type QueueManager } from "../../lib/queue"
import {
  isOutboxEventType,
  OutboxRepository,
  type OutboxHandler,
  type AttachmentExtractionCompletedOutboxPayload,
} from "../../lib/outbox"
import { CursorLock, ensureListenerFromLatest, DebounceWithMaxWait, type ProcessResult } from "@threa/backend-common"
import { isContentTypeEmbeddable } from "./embedding-config"

export interface AttachmentEmbeddingHandlerConfig {
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
 * Watches the outbox for `attachment:extraction_completed` events and
 * enqueues `ATTACHMENT_EMBED` jobs so the embedding worker can populate
 * `attachment_extractions.summary_embedding` out-of-band.
 *
 * Enqueue is filtered by `contentType` from the event payload so we don't
 * pay for queue churn on `photo`/`other` extractions; the worker re-checks
 * the same eligibility against the freshly-fetched extraction as a defence
 * against reprocessed content.
 */
export class AttachmentEmbeddingHandler implements OutboxHandler {
  readonly listenerId = "attachment-embedding"

  private readonly db: Pool
  private readonly jobQueue: QueueManager
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, jobQueue: QueueManager, config?: AttachmentEmbeddingHandlerConfig) {
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
      (err) => logger.error({ err, listenerId: this.listenerId }, "AttachmentEmbeddingHandler debouncer error")
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
          if (!isOutboxEventType(event, "attachment:extraction_completed")) {
            seen.push(event.id)
            continue
          }

          const payload: AttachmentExtractionCompletedOutboxPayload = event.payload

          if (!isContentTypeEmbeddable(payload.contentType)) {
            logger.debug(
              { attachmentId: payload.attachmentId, contentType: payload.contentType },
              "Skipping embedding job for ineligible content type"
            )
            seen.push(event.id)
            continue
          }

          await this.jobQueue.send(JobQueues.ATTACHMENT_EMBED, {
            attachmentId: payload.attachmentId,
            workspaceId: payload.workspaceId,
          })

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
