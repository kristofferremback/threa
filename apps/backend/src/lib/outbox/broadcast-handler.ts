import { Server } from "socket.io"
import type { Pool } from "pg"
import { MemberRepository } from "../../features/workspaces"
import {
  OutboxRepository,
  isStreamScopedEvent,
  isOutboxEventType,
  isOneOfOutboxEventType,
  isAuthorScopedEvent,
  isMemberScopedEvent,
  type OutboxEvent,
  type StreamCreatedOutboxPayload,
  type StreamMemberAddedOutboxPayload,
  type CommandDispatchedOutboxPayload,
  type CommandCompletedOutboxPayload,
  type CommandFailedOutboxPayload,
  type StreamReadOutboxPayload,
  type StreamsReadAllOutboxPayload,
  type UserPreferencesUpdatedOutboxPayload,
  type ActivityCreatedOutboxPayload,
  type StreamDisplayNameUpdatedPayload,
} from "./repository"
import type { UserSocketRegistry } from "../user-socket-registry"
import { logger } from "../logger"
import { CursorLock, ensureListenerFromLatest, type ProcessResult } from "../cursor-lock"
import { DebounceWithMaxWait } from "../debounce"
import type { OutboxHandler } from "./dispatcher"

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
      const events = await OutboxRepository.fetchAfterId(this.db, cursor, this.batchSize)

      if (events.length === 0) {
        return { status: "no_events" }
      }

      let lastProcessedId = cursor

      try {
        for (const event of events) {
          await this.broadcastEvent(event)
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

  private async broadcastEvent(event: OutboxEvent): Promise<void> {
    const { workspaceId } = event.payload

    // Member-scoped events: emit to the target member's sockets
    // targetMemberId → resolve to userId for socket registry lookup
    // Errors are caught per-event to prevent a single failed member lookup from
    // blocking the entire broadcast pipeline via cursor lock backoff.
    if (isMemberScopedEvent(event)) {
      const payload = event.payload as ActivityCreatedOutboxPayload
      const { targetMemberId } = payload

      try {
        const member = await MemberRepository.findById(this.db, targetMemberId)
        if (!member) {
          logger.warn(
            { eventType: event.eventType, targetMemberId },
            "Cannot broadcast member-scoped event: member not found"
          )
          return
        }

        const sockets = this.userSocketRegistry.getSockets(member.userId)
        for (const socket of sockets) {
          socket.emit(event.eventType, event.payload)
        }
        logger.debug(
          { eventType: event.eventType, targetMemberId, userId: member.userId, emitted: sockets.length },
          "Broadcast member-scoped event"
        )
      } catch (err) {
        logger.error(
          { err, eventType: event.eventType, eventId: event.id.toString(), targetMemberId },
          "Failed to broadcast member-scoped event, skipping"
        )
      }
      return
    }

    // Author-scoped events: only emit to the author's sockets
    // authorId is a memberId — resolve to userId for socket registry lookup
    if (isAuthorScopedEvent(event)) {
      const payload = event.payload as
        | CommandDispatchedOutboxPayload
        | CommandCompletedOutboxPayload
        | CommandFailedOutboxPayload
        | StreamReadOutboxPayload
        | StreamsReadAllOutboxPayload
        | UserPreferencesUpdatedOutboxPayload
      const { authorId } = payload

      try {
        const member = await MemberRepository.findById(this.db, authorId)
        if (!member) {
          logger.warn(
            { eventType: event.eventType, authorId },
            "Cannot broadcast author-scoped event: member not found"
          )
          return
        }

        const sockets = this.userSocketRegistry.getSockets(member.userId)
        for (const socket of sockets) {
          socket.emit(event.eventType, event.payload)
        }
        logger.debug(
          { eventType: event.eventType, authorId, userId: member.userId, emitted: sockets.length },
          "Broadcast author-scoped event"
        )
      } catch (err) {
        logger.error(
          { err, eventType: event.eventType, eventId: event.id.toString(), authorId },
          "Failed to broadcast author-scoped event, skipping"
        )
      }
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

    // stream:member_added: emit to stream room (existing members) AND the added
    // member's sockets directly — they haven't joined the stream room yet.
    if (isOutboxEventType(event, "stream:member_added")) {
      const { streamId, memberId } = event.payload as StreamMemberAddedOutboxPayload
      this.io.to(`ws:${workspaceId}:stream:${streamId}`).emit(event.eventType, event.payload)

      try {
        const member = await MemberRepository.findById(this.db, memberId)
        if (member) {
          const sockets = this.userSocketRegistry.getSockets(member.userId)
          for (const socket of sockets) {
            socket.emit(event.eventType, event.payload)
          }
        }
      } catch (err) {
        logger.error(
          { err, eventType: event.eventType, eventId: event.id.toString(), memberId },
          "Failed to resolve added member for direct emit, skipping"
        )
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

    // Display name updates for public streams go to the workspace room so all
    // workspace members can update their bootstrap cache (e.g. for activity/search
    // name resolution on streams the user isn't a member of). Private stream names
    // stay stream-scoped to avoid leaking DM/scratchpad thread names.
    if (isOutboxEventType(event, "stream:display_name_updated")) {
      const payload = event.payload as StreamDisplayNameUpdatedPayload
      if (payload.visibility === "public") {
        this.io.to(`ws:${workspaceId}`).emit(event.eventType, event.payload)
      } else {
        this.io.to(`ws:${workspaceId}:stream:${payload.streamId}`).emit(event.eventType, event.payload)
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
