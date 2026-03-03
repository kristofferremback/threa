import { useRef, useEffect, useCallback, useMemo } from "react"
import type { StreamEvent } from "@threa/types"

interface EditLastMessageTrigger {
  registerMessage: (messageId: string, openEdit: () => void) => () => void
  triggerEditLast: () => void
}

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
export function useEditLastMessageTrigger(events: StreamEvent[], currentUserId: string | null): EditLastMessageTrigger {
  // Registry: maps messageId → openEdit callback registered by mounted SentMessageEvent instances.
  // Ref-based so registration/deregistration never triggers re-renders.
  const editRegistryRef = useRef(new Map<string, () => void>())

  // Refs keep callbacks stable (empty dep array) so context consumers don't re-render on
  // every new message — same pattern as onEditLastMessageRef in rich-editor.tsx.
  const eventsRef = useRef(events)
  useEffect(() => {
    eventsRef.current = events
  }, [events])

  const currentUserIdRef = useRef(currentUserId)
  useEffect(() => {
    currentUserIdRef.current = currentUserId
  }, [currentUserId])

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
