import { useLiveQuery } from "dexie-react-hooks"
import { useCallback, useEffect, useRef } from "react"
import { db, type DraftAttachment } from "@/db"
import type { JSONContent } from "@threa/types"
import { isEmptyContent } from "@/lib/prosemirror-utils"

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

// Sentinel value to distinguish "loading" from "loaded but not found"
const LOADING = Symbol("loading")

export function useDraftMessage(workspaceId: string, draftKey: string) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Use LOADING sentinel as initial value so we can tell when Dexie has finished loading
  const draft = useLiveQuery(() => db.draftMessages.get(draftKey), [draftKey], LOADING as unknown)

  const saveDraft = useCallback(
    async (contentJson: JSONContent, attachments?: DraftAttachment[]) => {
      // Clear any pending debounced save
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }

      // Get current attachments if not provided
      const currentDraft = await db.draftMessages.get(draftKey)
      const finalAttachments = attachments ?? currentDraft?.attachments ?? []

      // Delete draft only if both content and attachments are empty
      if (isEmptyContent(contentJson) && finalAttachments.length === 0) {
        await db.draftMessages.delete(draftKey)
        return
      }

      await db.draftMessages.put({
        id: draftKey,
        workspaceId,
        contentJson,
        attachments: finalAttachments,
        updatedAt: Date.now(),
      })
    },
    [draftKey, workspaceId]
  )

  const saveDraftDebounced = useCallback(
    (contentJson: JSONContent) => {
      // Clear any pending debounced save
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        saveDraft(contentJson)
        debounceRef.current = null
      }, DEBOUNCE_MS)
    },
    [saveDraft]
  )

  /**
   * Add an attachment to the draft. Creates the draft if it doesn't exist.
   */
  const addAttachment = useCallback(
    async (attachment: DraftAttachment) => {
      const currentDraft = await db.draftMessages.get(draftKey)
      const currentAttachments = currentDraft?.attachments ?? []

      // Don't add duplicates
      if (currentAttachments.some((a) => a.id === attachment.id)) {
        return
      }

      // Default empty document
      const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }

      await db.draftMessages.put({
        id: draftKey,
        workspaceId,
        contentJson: currentDraft?.contentJson ?? emptyDoc,
        attachments: [...currentAttachments, attachment],
        updatedAt: Date.now(),
      })
    },
    [draftKey, workspaceId]
  )

  /**
   * Remove an attachment from the draft.
   * If this leaves the draft empty (no content, no attachments), the draft is deleted.
   */
  const removeAttachment = useCallback(
    async (attachmentId: string) => {
      const currentDraft = await db.draftMessages.get(draftKey)
      if (!currentDraft) return

      const remainingAttachments = (currentDraft.attachments ?? []).filter((a) => a.id !== attachmentId)

      // Delete draft if both content and attachments are empty
      if (isEmptyContent(currentDraft.contentJson) && remainingAttachments.length === 0) {
        await db.draftMessages.delete(draftKey)
        return
      }

      await db.draftMessages.put({
        ...currentDraft,
        attachments: remainingAttachments,
        updatedAt: Date.now(),
      })
    },
    [draftKey]
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

  // Check if we're still loading (draft is the LOADING sentinel)
  const isLoading = draft === LOADING
  const resolvedDraft = isLoading
    ? undefined
    : (draft as { contentJson?: JSONContent; attachments?: DraftAttachment[] } | undefined)

  // Default empty document
  const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }

  return {
    /** Whether Dexie has finished loading the draft (true even if no draft exists) */
    isLoaded: !isLoading,
    contentJson: resolvedDraft?.contentJson ?? emptyDoc,
    attachments: resolvedDraft?.attachments ?? [],
    saveDraft,
    saveDraftDebounced,
    addAttachment,
    removeAttachment,
    clearDraft,
  }
}
