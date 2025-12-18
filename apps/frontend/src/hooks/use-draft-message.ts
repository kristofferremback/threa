import { useLiveQuery } from "dexie-react-hooks"
import { useCallback, useEffect, useRef } from "react"
import { db } from "@/db"

// Key formats:
// - "stream:{streamId}" for messages in existing streams
// - "thread:{parentMessageId}" for new threads (reply to a message that doesn't have a thread yet)
export function getDraftMessageKey(
  location: { type: "stream"; streamId: string } | { type: "thread"; parentMessageId: string }
): string {
  if (location.type === "stream") {
    return `stream:${location.streamId}`
  }
  return `thread:${location.parentMessageId}`
}

const DEBOUNCE_MS = 500

export function useDraftMessage(workspaceId: string, draftKey: string) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const draft = useLiveQuery(() => db.draftMessages.get(draftKey), [draftKey], undefined)

  const saveDraft = useCallback(
    async (content: string) => {
      // Clear any pending debounced save
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }

      if (!content.trim()) {
        // If empty, delete the draft
        await db.draftMessages.delete(draftKey)
        return
      }

      await db.draftMessages.put({
        id: draftKey,
        workspaceId,
        content,
        updatedAt: Date.now(),
      })
    },
    [draftKey, workspaceId]
  )

  const saveDraftDebounced = useCallback(
    (content: string) => {
      // Clear any pending debounced save
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        saveDraft(content)
        debounceRef.current = null
      }, DEBOUNCE_MS)
    },
    [saveDraft]
  )

  const clearDraft = useCallback(async () => {
    // Clear any pending debounced save
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    await db.draftMessages.delete(draftKey)
  }, [draftKey])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  return {
    content: draft?.content ?? "",
    saveDraft,
    saveDraftDebounced,
    clearDraft,
  }
}
