import { Server } from "socket.io"
import type { Pool } from "pg"
import { StreamTypes } from "@threa/types"
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
  type ActivityCreatedOutboxPayload,
  type StreamDisplayNameUpdatedPayload,
} from "./repository"
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
 * Member-scoped events (activity) are broadcast to member rooms: `ws:${workspaceId}:member:${memberId}`
 * Author-scoped events (commands, read state) are broadcast to member rooms: `ws:${workspaceId}:member:${authorId}`
 *
 * Member rooms eliminate DB queries during broadcast — the memberId→userId mapping
 * is resolved once at socket connect time, not per-event.
 *
 * Uses time-based cursor locking for exclusive access without
 * holding database connections during processing.
 */
export class BroadcastHandler implements OutboxHandler {
  readonly listenerId = "broadcast"

  private readonly db: Pool
  private readonly io: Server
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, io: Server, config?: BroadcastHandlerConfig) {
    this.db = db
    this.io = io
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
    await this.cursorLock.run(async (cursor, processedIds): Promise<ProcessResult> => {
      const events = await OutboxRepository.fetchAfterId(this.db, cursor, this.batchSize, processedIds)

      if (events.length === 0) {
        return { status: "no_events" }
      }

      const seen: bigint[] = []

      try {
        for (const event of events) {
          this.broadcastEvent(event)
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

  private broadcastEvent(event: OutboxEvent): void {
    const { workspaceId } = event.payload

    // Member-scoped events: emit to the target member's room
    if (isMemberScopedEvent(event)) {
      const { targetMemberId } = event.payload as ActivityCreatedOutboxPayload
      this.io.to(`ws:${workspaceId}:member:${targetMemberId}`).emit(event.eventType, event.payload)
      return
    }

    // Author-scoped events: emit to the author's member room
    if (isAuthorScopedEvent(event)) {
      const { authorId } = event.payload as { authorId: string }
      this.io.to(`ws:${workspaceId}:member:${authorId}`).emit(event.eventType, event.payload)
      return
    }

    // Special handling for stream:created - route threads to parent stream room
    if (isOutboxEventType(event, "stream:created")) {
      const payload = event.payload as StreamCreatedOutboxPayload
      if (payload.stream.parentMessageId) {
        this.io.to(`ws:${workspaceId}:stream:${payload.streamId}`).emit(event.eventType, event.payload)
      } else if (payload.stream.type === StreamTypes.DM && payload.dmMemberIds?.length === 2) {
        for (const memberId of new Set(payload.dmMemberIds)) {
          this.io.to(`ws:${workspaceId}:member:${memberId}`).emit(event.eventType, event.payload)
        }
      } else {
        this.io.to(`ws:${workspaceId}`).emit(event.eventType, event.payload)
      }
      return
    }

    // stream:member_added: emit to stream room (existing members) AND the added
    // member's room directly — they haven't joined the stream room yet.
    if (isOutboxEventType(event, "stream:member_added")) {
      const { streamId, memberId } = event.payload as StreamMemberAddedOutboxPayload
      this.io.to(`ws:${workspaceId}:stream:${streamId}`).emit(event.eventType, event.payload)
      this.io.to(`ws:${workspaceId}:member:${memberId}`).emit(event.eventType, event.payload)
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
