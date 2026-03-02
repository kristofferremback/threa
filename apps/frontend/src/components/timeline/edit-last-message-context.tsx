import { createContext, useContext } from "react"

interface EditLastMessageContextValue {
  pendingEditMessageId: string | null
  clearPendingEdit: () => void
}

export const EditLastMessageContext = createContext<EditLastMessageContextValue | null>(null)

export function useEditLastMessage() {
  return useContext(EditLastMessageContext)
}
