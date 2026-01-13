import { useState, useCallback, useEffect, useRef, type ChangeEvent, type RefObject } from "react"
import { useDraftMessage } from "./use-draft-message"
import { useAttachments, type PendingAttachment, type UploadResult } from "./use-attachments"
import type { JSONContent } from "@threa/types"

export interface UseDraftComposerOptions {
  workspaceId: string
  draftKey: string
  /** ID used for detecting scope changes (streamId or parentMessageId) */
  scopeId: string
  /** Initial content (optional, for pre-filled content as JSON) */
  initialContent?: JSONContent
}

/** Default empty ProseMirror document */
const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }

/** Check if a document is empty (no actual text content) */
function hasDocContent(doc: JSONContent | undefined): boolean {
  if (!doc?.content) return false
  return doc.content.some((node) => {
    if (node.type === "paragraph") {
      return node.content && node.content.length > 0
    }
    return true // Non-paragraph nodes count as content
  })
}

export interface DraftComposerState {
  // Content
  content: JSONContent
  setContent: (content: JSONContent) => void
  handleContentChange: (newContent: JSONContent) => void

  // Attachments
  pendingAttachments: PendingAttachment[]
  uploadedIds: string[]
  isUploading: boolean
  hasFailed: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  handleFileSelect: (e: ChangeEvent<HTMLInputElement>) => void
  handleRemoveAttachment: (id: string) => void
  /** Upload a file programmatically (for paste/drop) */
  uploadFile: (file: File) => Promise<UploadResult>
  /** Current count of images (for sequential naming) */
  imageCount: number

  // Submission
  canSend: boolean
  isSending: boolean
  setIsSending: (sending: boolean) => void

  // Clear helpers
  clearDraft: () => Promise<void>
  clearAttachments: () => void

  // Loading
  isLoaded: boolean
}

export function useDraftComposer({
  workspaceId,
  draftKey,
  scopeId,
  initialContent = EMPTY_DOC,
}: UseDraftComposerOptions): DraftComposerState {
  // Draft message persistence
  const {
    isLoaded: isDraftLoaded,
    contentJson: savedDraft,
    attachments: savedAttachments,
    saveDraftDebounced,
    addAttachment: addDraftAttachment,
    removeAttachment: removeDraftAttachment,
    clearDraft,
  } = useDraftMessage(workspaceId, draftKey)

  // Attachment handling
  const {
    pendingAttachments,
    fileInputRef,
    handleFileSelect,
    uploadFile,
    removeAttachment,
    uploadedIds,
    isUploading,
    hasFailed,
    clear: clearAttachments,
    restore: restoreAttachments,
    imageCount,
  } = useAttachments(workspaceId)

  // Local state
  const [content, setContent] = useState<JSONContent>(initialContent)
  const [isSending, setIsSending] = useState(false)
  const hasInitialized = useRef(false)
  const prevScopeIdRef = useRef<string | null>(null)

  // Initialize content and attachments from saved draft, reset on scope change
  useEffect(() => {
    const isScopeChange = prevScopeIdRef.current !== null && prevScopeIdRef.current !== scopeId

    // On scope change, reset state
    if (isScopeChange) {
      hasInitialized.current = false
      setContent(initialContent)
      clearAttachments()
    }

    // Track scope changes
    if (prevScopeIdRef.current !== scopeId) {
      prevScopeIdRef.current = scopeId
    }

    // Wait for Dexie to finish loading before initializing
    if (!isDraftLoaded) {
      return
    }

    // Restore saved draft content and attachments
    if (!hasInitialized.current) {
      if (hasDocContent(savedDraft)) {
        setContent(savedDraft)
      }
      if (savedAttachments.length > 0) {
        restoreAttachments(savedAttachments)
      }
      hasInitialized.current = true
    }
  }, [scopeId, isDraftLoaded, savedDraft, savedAttachments, restoreAttachments, clearAttachments, initialContent])

  // When attachments change, persist to draft storage
  useEffect(() => {
    const uploaded = pendingAttachments.filter((a) => a.status === "uploaded" && !a.id.startsWith("temp_"))
    // Only update draft if we have uploaded attachments and we're past initialization
    if (hasInitialized.current && uploaded.length > 0) {
      // Sync each attachment to draft storage
      for (const a of uploaded) {
        addDraftAttachment({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
        })
      }
    }
  }, [pendingAttachments, addDraftAttachment])

  // Handle content change with draft persistence
  const handleContentChange = useCallback(
    (newContent: JSONContent) => {
      setContent(newContent)
      saveDraftDebounced(newContent)
    },
    [saveDraftDebounced]
  )

  // Handle attachment removal from both UI and draft storage
  const handleRemoveAttachment = useCallback(
    (id: string) => {
      removeAttachment(id)
      removeDraftAttachment(id)
    },
    [removeAttachment, removeDraftAttachment]
  )

  // Check if document has actual content (not just empty paragraphs)
  const hasContent =
    content.content?.some((node) => {
      if (node.type === "paragraph") {
        return node.content && node.content.length > 0
      }
      return true // Non-paragraph nodes count as content
    }) ?? false

  const canSend = (hasContent || uploadedIds.length > 0) && !isSending && !isUploading && !hasFailed

  return {
    // Content
    content,
    setContent,
    handleContentChange,

    // Attachments
    pendingAttachments,
    uploadedIds,
    isUploading,
    hasFailed,
    fileInputRef,
    handleFileSelect,
    handleRemoveAttachment,
    uploadFile,
    imageCount,

    // Submission
    canSend,
    isSending,
    setIsSending,

    // Clear helpers
    clearDraft,
    clearAttachments,

    // Loading
    isLoaded: isDraftLoaded,
  }
}
