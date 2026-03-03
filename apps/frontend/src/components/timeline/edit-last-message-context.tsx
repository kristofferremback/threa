import { createContext, useContext } from "react"

interface EditLastMessageContextValue {
  /**
   * Called by SentMessageEvent on mount to register its edit handler.
   * Returns a cleanup function that deregisters the handler on unmount.
   */
  registerMessage: (messageId: string, openEdit: () => void) => () => void
  /**
   * Called by the composer on ArrowUp in an empty editor.
   * Scans loaded events newest-first for the current user's last non-deleted message,
   * then imperatively calls its registered handler. Silent no-op when nothing qualifies.
   */
  triggerEditLast: () => void
}

export const EditLastMessageContext = createContext<EditLastMessageContextValue | null>(null)

export function useEditLastMessage() {
  return useContext(EditLastMessageContext)
}
