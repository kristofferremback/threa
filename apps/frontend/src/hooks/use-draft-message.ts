import { useCallback, useEffect, useRef } from "react"
import { db, type DraftAttachment, type DraftMessage } from "@/db"
import type { DraftContextRef } from "@/lib/context-bag/types"
import {
  deleteDraftMessageFromCache,
  hasSeededDraftCache,
  upsertDraftMessageInCache,
  useDraftMessagesFromStore,
} from "@/stores/draft-store"
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

const DEBOUNCE_MS = import.meta.env.VITE_DRAFT_DEBOUNCE_MS ? Number(import.meta.env.VITE_DRAFT_DEBOUNCE_MS) : 500

export function useDraftMessage(workspaceId: string, draftKey: string) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftMessages = useDraftMessagesFromStore(workspaceId)
  const resolvedDraft = draftMessages.find((draft) => draft.id === draftKey)

  const saveDraft = useCallback(
    async (contentJson: JSONContent, attachments?: DraftAttachment[]) => {
      // Clear any pending debounced save
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }

      // Get current attachments + contextRefs if not provided. The contextRefs
      // sidecar must survive a content-only save (e.g. user typing into a
      // bag-attached scratchpad) — without this preservation the chip would
      // vanish from the composer the moment the first keystroke fires.
      const currentDraft = await db.draftMessages.get(draftKey)
      const finalAttachments = attachments ?? currentDraft?.attachments ?? []
      const finalContextRefs = currentDraft?.contextRefs ?? []

      // Delete draft only when content + attachments + contextRefs are all empty.
      if (isEmptyContent(contentJson) && finalAttachments.length === 0 && finalContextRefs.length === 0) {
        await db.draftMessages.delete(draftKey)
        deleteDraftMessageFromCache(workspaceId, draftKey)
        return
      }

      const nextDraft: DraftMessage = {
        id: draftKey,
        workspaceId,
        contentJson,
        attachments: finalAttachments,
        contextRefs: finalContextRefs.length > 0 ? finalContextRefs : undefined,
        updatedAt: Date.now(),
      }
      await db.draftMessages.put(nextDraft)
      upsertDraftMessageInCache(workspaceId, nextDraft)
    },
    [draftKey, workspaceId, resolvedDraft]
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

      const nextDraft: DraftMessage = {
        id: draftKey,
        workspaceId,
        contentJson: currentDraft?.contentJson ?? emptyDoc,
        attachments: [...currentAttachments, attachment],
        // Preserve sidecar so a paste/upload doesn't wipe an attached chip.
        contextRefs: currentDraft?.contextRefs,
        updatedAt: Date.now(),
      }
      await db.draftMessages.put(nextDraft)
      upsertDraftMessageInCache(workspaceId, nextDraft)
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
        deleteDraftMessageFromCache(workspaceId, draftKey)
        return
      }

      const nextDraft: DraftMessage = {
        ...currentDraft,
        attachments: remainingAttachments,
        updatedAt: Date.now(),
      }
      await db.draftMessages.put(nextDraft)
      upsertDraftMessageInCache(workspaceId, nextDraft)
    },
    [draftKey, workspaceId]
  )

  const clearDraft = useCallback(async () => {
    // Clear any pending debounced save
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    await db.draftMessages.delete(draftKey)
    deleteDraftMessageFromCache(workspaceId, draftKey)
  }, [draftKey, workspaceId])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  // Default empty document
  const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }

  return {
    /** Whether Dexie has finished loading the draft (true even if no draft exists) */
    isLoaded: hasSeededDraftCache(workspaceId),
    contentJson: resolvedDraft?.contentJson ?? emptyDoc,
    attachments: resolvedDraft?.attachments ?? [],
    /** Sidecar context refs attached to the draft (see DraftContextRef). */
    contextRefs: (resolvedDraft?.contextRefs ?? []) as DraftContextRef[],
    saveDraft,
    saveDraftDebounced,
    addAttachment,
    removeAttachment,
    clearDraft,
  }
}
