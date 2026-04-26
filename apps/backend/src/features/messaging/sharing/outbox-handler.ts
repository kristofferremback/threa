import type { Pool } from "pg"
import type { Server } from "socket.io"
import type { OutboxEvent } from "../../../lib/outbox"
import { SharedMessageRepository } from "./repository"

/**
 * Event name emitted to target streams when a pointer-referenced source
 * message has been edited or deleted. The client uses it as a cache-bust hint
 * to re-fetch the hydrated pointer content. Lives on the realtime channel,
 * not the outbox — there's no persistent state change on the share row
 * itself (INV-4).
 */
export const POINTER_INVALIDATED_EVENT = "pointer:invalidated"

/**
 * Extract the source messageId from an outbox event that signals the source
 * has changed. Returns null when the event is for a different type or when
 * the payload shape is unexpected.
 *
 * Only `message:edited` (content change) and `message:deleted` (tombstone)
 * affect what a hydrated pointer renders. `message:updated` is reserved for
 * thread-reply-count bumps (`event-service.ts:163`) and never carries a
 * content delta, so including it here would fan out a `pointer:invalidated`
 * to every target stream of every shared parent message on every reply —
 * a pure cache-bust with nothing to re-fetch.
 */
function extractMessageIdForInvalidation(event: OutboxEvent): string | null {
  if (event.eventType === "message:edited") {
    const inner = (event.payload as { event?: { payload?: { messageId?: string } } }).event
    return inner?.payload?.messageId ?? null
  }
  if (event.eventType === "message:deleted") {
    return (event.payload as { messageId?: string }).messageId ?? null
  }
  return null
}

/**
 * If the given outbox event signals a source message change, look up every
 * target stream that hosts a pointer to it and emit `pointer:invalidated`
 * to those streams' rooms so subscribed clients re-fetch the hydrated
 * content. No-op for event types that don't affect pointer renders.
 *
 * Called from `BroadcastHandler.processEvents` after the normal broadcast
 * so pointer consumers learn about edits without duplicating the source
 * message's own broadcast.
 */
export async function invalidatePointersForEvent(event: OutboxEvent, db: Pool, io: Server): Promise<void> {
  const sourceMessageId = extractMessageIdForInvalidation(event)
  if (!sourceMessageId) return

  const { workspaceId } = event.payload as { workspaceId: string }
  const shares = await SharedMessageRepository.listBySourceMessageIds(db, workspaceId, [sourceMessageId])
  if (shares.length === 0) return

  const targetStreamIds = new Set(shares.map((s) => s.targetStreamId))
  for (const targetStreamId of targetStreamIds) {
    io.to(`ws:${workspaceId}:stream:${targetStreamId}`).emit(POINTER_INVALIDATED_EVENT, {
      workspaceId,
      targetStreamId,
      sourceMessageId,
    })
  }
}
