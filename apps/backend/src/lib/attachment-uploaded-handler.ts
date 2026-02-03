import type { Pool } from "pg"
import { OutboxRepository, AttachmentRepository, isOutboxEventType } from "../repositories"
import { logger } from "./logger"
import { JobQueues } from "./job-queue"
import type { QueueManager } from "./queue-manager"
import { CursorLock, ensureListenerFromLatest, type ProcessResult } from "./cursor-lock"
import { DebounceWithMaxWait } from "./debounce"
import type { OutboxHandler } from "./outbox-dispatcher"
import { isImageAttachment } from "../services/image-caption"
import { ProcessingStatuses } from "@threa/types"

export interface AttachmentUploadedHandlerConfig {
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
 * Handler that processes attachment:uploaded events.
 *
 * For images: enqueues IMAGE_CAPTION job for AI processing
 * For non-images: sets status='skipped' (no processing needed)
 */
export class AttachmentUploadedHandler implements OutboxHandler {
  readonly listenerId = "attachment-uploaded"

  private readonly db: Pool
  private readonly jobQueue: QueueManager
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, jobQueue: QueueManager, config?: AttachmentUploadedHandlerConfig) {
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
      (err) => logger.error({ err, listenerId: this.listenerId }, "AttachmentUploadedHandler debouncer error")
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
          if (!isOutboxEventType(event, "attachment:uploaded")) {
            lastProcessedId = event.id
            continue
          }

          const { attachmentId, workspaceId, filename, mimeType, storagePath } = event.payload

          if (isImageAttachment(mimeType, filename)) {
            // Enqueue image captioning job
            await this.jobQueue.send(JobQueues.IMAGE_CAPTION, {
              attachmentId,
              workspaceId,
              filename,
              mimeType,
              storagePath,
            })

            logger.info({ attachmentId, filename, mimeType }, "Image caption job dispatched")
          } else {
            // Non-image: mark as skipped
            await AttachmentRepository.updateProcessingStatus(this.db, attachmentId, ProcessingStatuses.SKIPPED)
            logger.debug({ attachmentId, filename, mimeType }, "Non-image attachment marked as skipped")
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
}
