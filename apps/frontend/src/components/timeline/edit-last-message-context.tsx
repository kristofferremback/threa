import { createContext, useContext, useCallback } from "react"
import type { StreamEvent } from "@threa/types"

interface EditLastMessageContextValue {
  pendingEditMessageId: string | null
  clearPendingEdit: () => void
}

export const EditLastMessageContext = createContext<EditLastMessageContextValue | null>(null)

export function useEditLastMessage() {
  return useContext(EditLastMessageContext)
}

/**
 * Returns a callback that, when invoked, scans events newest-first for the current user's
 * last non-deleted message and calls onFound with its messageId. The caller is responsible
 * for resolving currentWorkspaceUserId (workspace-scoped, same space as event.actorId).
 */
export function useTriggerEditLastMessage(
  currentWorkspaceUserId: string | null,
  events: StreamEvent[],
  onFound: (messageId: string) => void
) {
  return useCallback(() => {
    if (!currentWorkspaceUserId) return
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event.eventType !== "message_created") continue
      if (event.actorType !== "user") continue
      if (event.actorId !== currentWorkspaceUserId) continue
      const payload = event.payload as { messageId?: string; deletedAt?: string }
      if (payload.deletedAt || !payload.messageId) continue
      onFound(payload.messageId)
      return
    }
  }, [events, currentWorkspaceUserId, onFound])
}
