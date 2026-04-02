import { createContext, useContext } from "react"

export interface EditLastMessageContextValue {
  /**
   * Called by SentMessageEvent on mount to register its edit handler.
   * Returns a cleanup function that deregisters the handler on unmount.
   */
  registerMessage: (messageId: string, openEdit: () => void) => () => void
  /**
   * Called by the composer on ArrowUp in an empty editor.
   * Scans loaded events newest-first for the current user's last non-deleted message,
   * then imperatively calls its registered handler.
   * Returns the target messageId if the message was found but not mounted (off-screen
   * in a virtualized list), so the caller can scroll to it and retry.
   * Returns null if the edit was triggered or no qualifying message exists.
   */
  triggerEditLast: () => string | null
}

export const EditLastMessageContext = createContext<EditLastMessageContextValue | null>(null)

export function useEditLastMessage() {
  return useContext(EditLastMessageContext)
}
