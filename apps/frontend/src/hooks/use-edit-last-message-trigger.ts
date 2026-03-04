import { useRef, useCallback, useMemo } from "react"
import type { StreamEvent } from "@threa/types"
import type { EditLastMessageContextValue } from "@/components/timeline/edit-last-message-context"

/**
 * Manages the "press ArrowUp to edit last message" feature for a stream.
 *
 * Maintains a ref-based registry (messageId → openEdit callback) so that
 * SentMessageEvent components can register themselves. triggerEditLast scans
 * events newest-first for the current user's last non-deleted message and
 * calls its registered handler.
 *
 * Both callbacks are stable (never recreated) — context consumers don't
 * re-render when new messages arrive.
 */
export function useEditLastMessageTrigger(
  events: StreamEvent[],
  currentUserId: string | null
): EditLastMessageContextValue {
  // Registry: maps messageId → openEdit callback registered by mounted SentMessageEvent instances.
  // Ref-based so registration/deregistration never triggers re-renders.
  const editRegistryRef = useRef(new Map<string, () => void>())

  // Inline synchronous assignments keep refs current on every render, matching the
  // onEditLastMessageRef pattern in rich-editor.tsx. This avoids a stale-ref window
  // that useEffect updates would introduce between a render and its effect flush.
  const eventsRef = useRef(events)
  eventsRef.current = events

  const currentUserIdRef = useRef(currentUserId)
  currentUserIdRef.current = currentUserId

  const registerMessage = useCallback((messageId: string, openEdit: () => void) => {
    editRegistryRef.current.set(messageId, openEdit)
    return () => editRegistryRef.current.delete(messageId)
  }, [])

  // Scan events newest-first for the current user's last non-deleted message,
  // then call its registered handler. Silent no-op if nothing qualifies or not loaded.
  const triggerEditLast = useCallback(() => {
    const userId = currentUserIdRef.current
    if (!userId) return

    // Collect deleted message IDs from message_deleted events. Bootstrap-window events
    // have deletedAt injected into message_created payloads, but paginated events don't —
    // they carry a separate message_deleted event instead.
    const deletedIds = new Set<string>()
    for (const event of eventsRef.current) {
      if (event.eventType === "message_deleted") {
        const p = event.payload as { messageId?: string }
        if (p.messageId) deletedIds.add(p.messageId)
      }
    }

    for (let i = eventsRef.current.length - 1; i >= 0; i--) {
      const event = eventsRef.current[i]
      if (event.eventType !== "message_created") continue
      if (event.actorType !== "user") continue
      if (event.actorId !== userId) continue
      const payload = event.payload as { messageId?: string; deletedAt?: string }
      if (!payload.messageId) continue
      if (payload.deletedAt || deletedIds.has(payload.messageId)) continue
      // If the message is not mounted (e.g., not yet loaded), nothing is registered — correct no-op.
      editRegistryRef.current.get(payload.messageId)?.()
      return
    }
  }, []) // stable — reads from refs, never recreated

  return useMemo(() => ({ registerMessage, triggerEditLast }), [registerMessage, triggerEditLast])
}
