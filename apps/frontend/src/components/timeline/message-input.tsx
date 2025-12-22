import { useState, useCallback, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Paperclip } from "lucide-react"
import { RichEditor } from "@/components/editor"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { useDraftMessage, getDraftMessageKey, useStreamOrDraft, useAttachments } from "@/hooks"
import { PendingAttachments } from "./pending-attachments"

interface MessageInputProps {
  workspaceId: string
  streamId: string
}

export function MessageInput({ workspaceId, streamId }: MessageInputProps) {
  const navigate = useNavigate()
  const { sendMessage } = useStreamOrDraft(workspaceId, streamId)

  // Draft message persistence
  const draftKey = getDraftMessageKey({ type: "stream", streamId })
  const {
    isLoaded: isDraftLoaded,
    content: savedDraft,
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
    removeAttachment,
    uploadedIds,
    isUploading,
    hasFailed,
    clear: clearAttachments,
    restore: restoreAttachments,
  } = useAttachments(workspaceId)

  // Local state for immediate UI updates
  const [content, setContent] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasInitialized = useRef(false)
  const prevStreamIdRef = useRef<string | null>(null)

  // Initialize content and attachments from saved draft, reset on stream change
  useEffect(() => {
    const isStreamChange = prevStreamIdRef.current !== null && prevStreamIdRef.current !== streamId

    // On stream change, reset state
    if (isStreamChange) {
      hasInitialized.current = false
      setContent("")
      clearAttachments()
    }

    // Track stream changes
    if (prevStreamIdRef.current !== streamId) {
      prevStreamIdRef.current = streamId
    }

    // Wait for Dexie to finish loading before initializing
    if (!isDraftLoaded) {
      return
    }

    // Restore saved draft content and attachments
    if (!hasInitialized.current) {
      if (savedDraft) {
        setContent(savedDraft)
      }
      if (savedAttachments.length > 0) {
        restoreAttachments(savedAttachments)
      }
      hasInitialized.current = true
    }
  }, [streamId, isDraftLoaded, savedDraft, savedAttachments, restoreAttachments, clearAttachments])

  // Sync attachment changes to draft storage
  const handleFileSelectWithDraft = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      await handleFileSelect(e)
    },
    [handleFileSelect]
  )

  // When attachments change, persist to draft
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

  const handleRemoveAttachment = useCallback(
    (id: string) => {
      removeAttachment(id)
      removeDraftAttachment(id)
    },
    [removeAttachment, removeDraftAttachment]
  )

  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent)
      saveDraftDebounced(newContent)
    },
    [saveDraftDebounced]
  )

  const canSend = (content.trim() || uploadedIds.length > 0) && !isSending && !isUploading && !hasFailed

  const handleSubmit = useCallback(async () => {
    const trimmed = content.trim()
    if (!canSend) return

    setIsSending(true)
    setError(null)

    // Clear input immediately for responsiveness
    setContent("")
    clearDraft()
    const attachmentIds = uploadedIds
    clearAttachments()

    try {
      const result = await sendMessage({
        content: trimmed || " ", // Backend requires content, use space for attachment-only messages
        contentFormat: "markdown",
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      })
      if (result.navigateTo) {
        navigate(result.navigateTo, { replace: result.replace ?? false })
      }
    } catch {
      // This only happens for draft promotion failure (stream creation failed)
      // Real stream message failures are handled in the timeline with retry
      setError("Failed to create stream. Please try again.")
    } finally {
      setIsSending(false)
    }
  }, [content, canSend, sendMessage, navigate, clearDraft, uploadedIds, clearAttachments])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="border-t p-4">
        <PendingAttachments attachments={pendingAttachments} onRemove={handleRemoveAttachment} />

        <div className="flex gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelectWithDraft}
            disabled={isSending}
          />

          {/* Upload button */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="self-end shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            title="Attach files"
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <RichEditor
            value={content}
            onChange={handleContentChange}
            onSubmit={handleSubmit}
            placeholder="Type a message... (Cmd+Enter to send)"
            disabled={isSending}
          />

          {hasFailed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="self-end">
                  <Button disabled className="pointer-events-none">
                    Send
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Remove failed uploads before sending</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button onClick={handleSubmit} disabled={!canSend} className="self-end">
              {isSending ? "Sending..." : "Send"}
            </Button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    </TooltipProvider>
  )
}
