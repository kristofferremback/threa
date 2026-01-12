import { Server } from "socket.io"
import type { Pool } from "pg"
import { OutboxRepository } from "../repositories"
import {
  isStreamScopedEvent,
  isOutboxEventType,
  isOneOfOutboxEventType,
  isAuthorScopedEvent,
  type OutboxEvent,
  type StreamCreatedOutboxPayload,
  type CommandDispatchedOutboxPayload,
  type CommandCompletedOutboxPayload,
  type CommandFailedOutboxPayload,
  type StreamReadOutboxPayload,
  type StreamsReadAllOutboxPayload,
  type UserPreferencesUpdatedOutboxPayload,
} from "../repositories/outbox-repository"
import type { UserSocketRegistry } from "./user-socket-registry"
import { logger } from "./logger"
import { CursorLock, ensureListenerFromLatest, type ProcessResult } from "./cursor-lock"
import { DebounceWithMaxWait } from "./debounce"
import type { OutboxHandler } from "./outbox-dispatcher"
import { withClient } from "../db"

export interface BroadcastHandlerConfig {
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
  debounceMs: 10, // Low debounce for real-time responsiveness
  maxWaitMs: 50,
  lockDurationMs: 10_000,
  refreshIntervalMs: 5_000,
  maxRetries: 5,
  baseBackoffMs: 1_000,
}

/**
 * Handler that broadcasts outbox events to Socket.io rooms.
 *
 * Stream-scoped events (messages, reactions) are broadcast to stream rooms: `ws:${workspaceId}:stream:${streamId}`
 * Workspace-scoped events (stream metadata, attachments) are broadcast to workspace rooms: `ws:${workspaceId}`
 * Author-scoped events (commands) are broadcast only to sockets belonging to the author.
 *
 * Uses time-based cursor locking for exclusive access without
 * holding database connections during processing.
 */
export class BroadcastHandler implements OutboxHandler {
  readonly listenerId = "broadcast"

  private readonly db: Pool
  private readonly io: Server
  private readonly userSocketRegistry: UserSocketRegistry
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, io: Server, userSocketRegistry: UserSocketRegistry, config?: BroadcastHandlerConfig) {
    this.db = db
    this.io = io
    this.userSocketRegistry = userSocketRegistry
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
      (err) => logger.error({ err, listenerId: this.listenerId }, "BroadcastHandler debouncer error")
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
      const events = await withClient(this.db, (client) =>
        OutboxRepository.fetchAfterId(client, cursor, this.batchSize)
      )

      if (events.length === 0) {
        return { status: "no_events" }
      }

      let lastProcessedId = cursor

      try {
        for (const event of events) {
          this.broadcastEvent(event)
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

  private broadcastEvent(event: OutboxEvent): void {
    const { workspaceId } = event.payload

    // Author-scoped events: only emit to the author's sockets
    if (isAuthorScopedEvent(event)) {
      const payload = event.payload as
        | CommandDispatchedOutboxPayload
        | CommandCompletedOutboxPayload
        | CommandFailedOutboxPayload
        | StreamReadOutboxPayload
        | StreamsReadAllOutboxPayload
        | UserPreferencesUpdatedOutboxPayload
      const { authorId } = payload

      // O(1) lookup via in-memory registry instead of filtering all sockets in room
      const sockets = this.userSocketRegistry.getSockets(authorId)
      for (const socket of sockets) {
        socket.emit(event.eventType, event.payload)
      }
      logger.debug({ eventType: event.eventType, authorId, emitted: sockets.length }, "Broadcast author-scoped event")
      return
    }

    // Special handling for stream:created - route threads to parent stream room
    if (isOutboxEventType(event, "stream:created")) {
      const payload = event.payload as StreamCreatedOutboxPayload
      if (payload.stream.parentMessageId) {
        this.io.to(`ws:${workspaceId}:stream:${payload.streamId}`).emit(event.eventType, event.payload)
      } else {
        this.io.to(`ws:${workspaceId}`).emit(event.eventType, event.payload)
      }
      return
    }

    // Conversation events broadcast to stream + optionally parent stream for discoverability
    if (isOneOfOutboxEventType(event, ["conversation:created", "conversation:updated"])) {
      const payload = event.payload as { streamId: string; parentStreamId?: string }
      this.io.to(`ws:${workspaceId}:stream:${payload.streamId}`).emit(event.eventType, event.payload)
      if (payload.parentStreamId) {
        this.io.to(`ws:${workspaceId}:stream:${payload.parentStreamId}`).emit(event.eventType, event.payload)
      }
      return
    }

    if (isStreamScopedEvent(event)) {
      const { streamId } = event.payload
      this.io.to(`ws:${workspaceId}:stream:${streamId}`).emit(event.eventType, event.payload)
    } else {
      this.io.to(`ws:${workspaceId}`).emit(event.eventType, event.payload)
    }
  }
}
