import type { Pool } from "pg"
import { OutboxRepository, PendingItemRepository, StreamStateRepository, StreamRepository } from "../repositories"
import { parseMessageCreatedPayload } from "./outbox-payload-parsers"
import { pendingItemId } from "./id"
import { AuthorTypes, StreamTypes } from "@threa/types"
import { logger } from "./logger"
import { CursorLock, ensureListenerFromLatest, type ProcessResult } from "./cursor-lock"
import { DebounceWithMaxWait } from "./debounce"
import type { OutboxHandler } from "./outbox-dispatcher"
import { withClient } from "../db"

export interface MemoAccumulatorHandlerConfig {
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
 * Handler that queues messages and conversations for batch memo processing.
 *
 * Flow:
 * 1. Event arrives (message:created, conversation:created, conversation:updated)
 * 2. Queue item to memo_pending_items table
 * 3. Update stream state activity for debounce tracking
 *
 * The batch worker will process queued items based on per-stream debouncing:
 * - Cap: process at most every 5 minutes per stream
 * - Quick: process after 30s quiet per stream
 */
export class MemoAccumulatorHandler implements OutboxHandler {
  readonly listenerId = "memo-accumulator"

  private readonly db: Pool
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, config?: MemoAccumulatorHandlerConfig) {
    this.db = db
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
      (err) => logger.error({ err, listenerId: this.listenerId }, "MemoAccumulatorHandler debouncer error")
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
          switch (event.eventType) {
            case "message:created":
              await this.handleMessageCreated(event)
              break
            case "conversation:created":
            case "conversation:updated":
              await this.handleConversationEvent(event)
              break
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

  private async handleMessageCreated(outboxEvent: { id: bigint; payload: unknown }): Promise<void> {
    const payload = parseMessageCreatedPayload(outboxEvent.payload)
    if (!payload) {
      logger.debug({ eventId: outboxEvent.id.toString() }, "MemoAccumulatorHandler: malformed event, skipping")
      return
    }

    const { streamId, workspaceId, event } = payload

    if (event.actorType !== AuthorTypes.USER) {
      return
    }

    const messageId = event.payload.messageId

    await withClient(this.db, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        logger.warn({ streamId }, "Stream not found for memo accumulator")
        return
      }

      const topLevelStreamId = stream.type === StreamTypes.THREAD ? (stream.rootStreamId ?? streamId) : streamId

      await PendingItemRepository.queue(client, [
        {
          id: pendingItemId(),
          workspaceId,
          streamId: topLevelStreamId,
          itemType: "message",
          itemId: messageId,
        },
      ])

      await StreamStateRepository.upsertActivity(client, workspaceId, topLevelStreamId)

      logger.debug({ workspaceId, streamId: topLevelStreamId, messageId }, "Message queued for memo processing")
    })
  }

  private async handleConversationEvent(outboxEvent: { id: bigint; payload: unknown }): Promise<void> {
    const payload = outboxEvent.payload as unknown as Record<string, unknown>

    if (
      typeof payload.streamId !== "string" ||
      typeof payload.workspaceId !== "string" ||
      typeof payload.conversationId !== "string"
    ) {
      return
    }

    const { streamId, workspaceId, conversationId } = payload as {
      streamId: string
      workspaceId: string
      conversationId: string
    }

    await withClient(this.db, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        logger.warn({ streamId }, "Stream not found for memo accumulator")
        return
      }

      const topLevelStreamId = stream.type === StreamTypes.THREAD ? (stream.rootStreamId ?? streamId) : streamId

      await PendingItemRepository.queue(client, [
        {
          id: pendingItemId(),
          workspaceId,
          streamId: topLevelStreamId,
          itemType: "conversation",
          itemId: conversationId,
        },
      ])

      await StreamStateRepository.upsertActivity(client, workspaceId, topLevelStreamId)

      logger.debug(
        { workspaceId, streamId: topLevelStreamId, conversationId },
        "Conversation queued for memo processing"
      )
    })
  }
}
