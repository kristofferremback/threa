import type { Pool } from "pg"
import { OutboxRepository, isOutboxEventType } from "../../repositories"
import { logger } from "../../lib/logger"
import { JobQueues } from "../../lib/job-queue"
import type { QueueManager } from "../../lib/queue-manager"
import { CursorLock, ensureListenerFromLatest, type ProcessResult } from "../../lib/cursor-lock"
import { DebounceWithMaxWait } from "../../lib/debounce"
import type { OutboxHandler } from "../../lib/outbox-dispatcher"
import { isImageAttachment } from "./image-caption"
import { isPdfAttachment } from "./pdf"
import { isWordAttachment } from "./word"
import { isExcelAttachment } from "./excel"

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
 * For PDFs: enqueues PDF_PREPARE job for document extraction
 * For others: enqueues TEXT_PROCESS job (binary detection decides skip vs process)
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

          switch (true) {
            case isImageAttachment(mimeType, filename):
              await this.jobQueue.send(JobQueues.IMAGE_CAPTION, {
                attachmentId,
                workspaceId,
                filename,
                mimeType,
                storagePath,
              })
              logger.info({ attachmentId, filename, mimeType }, "Image caption job dispatched")
              break

            case isPdfAttachment(mimeType, filename):
              await this.jobQueue.send(JobQueues.PDF_PREPARE, {
                attachmentId,
                workspaceId,
                filename,
                storagePath,
              })
              logger.info({ attachmentId, filename, mimeType }, "PDF prepare job dispatched")
              break

            case isWordAttachment(mimeType, filename):
              await this.jobQueue.send(JobQueues.WORD_PROCESS, {
                attachmentId,
                workspaceId,
                filename,
                storagePath,
              })
              logger.info({ attachmentId, filename, mimeType }, "Word processing job dispatched")
              break

            case isExcelAttachment(mimeType, filename):
              await this.jobQueue.send(JobQueues.EXCEL_PROCESS, {
                attachmentId,
                workspaceId,
                filename,
                storagePath,
              })
              logger.info({ attachmentId, filename, mimeType }, "Excel processing job dispatched")
              break

            default:
              // Route everything else to text processing — binary detection decides skip vs process
              await this.jobQueue.send(JobQueues.TEXT_PROCESS, {
                attachmentId,
                workspaceId,
                filename,
                storagePath,
              })
              logger.info({ attachmentId, filename, mimeType }, "Text processing job dispatched")
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
