import { useState, useCallback, useRef, useEffect, type ChangeEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Paperclip, X, Loader2, FileText, Image, File, AlertCircle } from "lucide-react"
import { RichEditor } from "@/components/editor"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { useDraftMessage, getDraftMessageKey, useStreamOrDraft } from "@/hooks"
import { attachmentsApi } from "@/api"
import { cn } from "@/lib/utils"

interface MessageInputProps {
  workspaceId: string
  streamId: string
}

interface PendingAttachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  status: "uploading" | "uploaded" | "error"
  error?: string
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image
  if (mimeType.startsWith("text/") || mimeType === "application/pdf") return FileText
  return File
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function MessageInput({ workspaceId, streamId }: MessageInputProps) {
  const navigate = useNavigate()
  const { sendMessage } = useStreamOrDraft(workspaceId, streamId)

  // Draft message persistence
  const draftKey = getDraftMessageKey({ type: "stream", streamId })
  const {
    content: savedDraft,
    attachments: savedAttachments,
    saveDraftDebounced,
    addAttachment: addDraftAttachment,
    removeAttachment: removeDraftAttachment,
    clearDraft,
  } = useDraftMessage(workspaceId, draftKey)

  // Local state for immediate UI updates
  const [content, setContent] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const hasInitialized = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Initialize content and attachments from saved draft (only once per stream)
  useEffect(() => {
    if (!hasInitialized.current && (savedDraft || savedAttachments.length > 0)) {
      if (savedDraft) {
        setContent(savedDraft)
      }
      if (savedAttachments.length > 0) {
        // Restore attachments from draft as already-uploaded
        setPendingAttachments(
          savedAttachments.map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            status: "uploaded" as const,
          }))
        )
      }
      hasInitialized.current = true
    }
  }, [savedDraft, savedAttachments])

  // Reset initialization flag when stream changes
  useEffect(() => {
    hasInitialized.current = false
    setContent("")
    setPendingAttachments([])
  }, [streamId])

  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent)
      saveDraftDebounced(newContent)
    },
    [saveDraftDebounced]
  )

  const handleFileSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return

      // Reset input so same file can be selected again
      e.target.value = ""

      for (const file of Array.from(files)) {
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`

        // Add as uploading
        setPendingAttachments((prev) => [
          ...prev,
          {
            id: tempId,
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            status: "uploading",
          },
        ])

        try {
          // Upload to workspace-level (streamId assigned on message creation)
          const attachment = await attachmentsApi.upload(workspaceId, file)

          if (!attachment || !attachment.id) {
            throw new Error("Invalid response: missing attachment data")
          }

          // Replace temp with real attachment
          setPendingAttachments((prev) =>
            prev.map((a) =>
              a.id === tempId
                ? {
                    id: attachment.id,
                    filename: attachment.filename,
                    mimeType: attachment.mimeType,
                    sizeBytes: attachment.sizeBytes,
                    status: "uploaded" as const,
                  }
                : a
            )
          )

          // Persist to draft so it survives page refresh
          addDraftAttachment({
            id: attachment.id,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          })
        } catch (err) {
          // Mark as error
          setPendingAttachments((prev) =>
            prev.map((a) =>
              a.id === tempId
                ? {
                    ...a,
                    status: "error" as const,
                    error: err instanceof Error ? err.message : "Upload failed",
                  }
                : a
            )
          )
        }
      }
    },
    [workspaceId, addDraftAttachment]
  )

  const removeAttachment = useCallback(
    async (attachmentId: string) => {
      const attachment = pendingAttachments.find((a) => a.id === attachmentId)
      if (!attachment) return

      // Remove from UI immediately
      setPendingAttachments((prev) => prev.filter((a) => a.id !== attachmentId))

      // Remove from draft storage
      removeDraftAttachment(attachmentId)

      // If it was successfully uploaded, delete from server
      if (attachment.status === "uploaded" && !attachmentId.startsWith("temp_")) {
        try {
          await attachmentsApi.delete(workspaceId, attachmentId)
        } catch (err) {
          // Log but don't fail - file will be cleaned up by server eventually
          console.warn("Failed to delete attachment from server:", err)
        }
      }
    },
    [pendingAttachments, workspaceId, removeDraftAttachment]
  )

  const uploadedAttachmentIds = pendingAttachments
    .filter((a) => a.status === "uploaded" && !a.id.startsWith("temp_"))
    .map((a) => a.id)

  const hasUploadingFiles = pendingAttachments.some((a) => a.status === "uploading")
  const hasFailedFiles = pendingAttachments.some((a) => a.status === "error")
  const canSend =
    (content.trim() || uploadedAttachmentIds.length > 0) && !isSending && !hasUploadingFiles && !hasFailedFiles

  const handleSubmit = useCallback(async () => {
    const trimmed = content.trim()
    if (!canSend) return

    setIsSending(true)
    setError(null)

    // Clear input immediately for responsiveness
    setContent("")
    clearDraft()
    const attachmentIds = uploadedAttachmentIds
    setPendingAttachments([])

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
  }, [content, canSend, sendMessage, navigate, clearDraft, uploadedAttachmentIds])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="border-t p-4">
        {/* Pending attachments */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {pendingAttachments.map((attachment) => {
              const Icon = getFileIcon(attachment.mimeType)
              const isError = attachment.status === "error"

              const attachmentChip = (
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2 py-1 text-xs",
                    isError && "border-destructive bg-destructive/10",
                    attachment.status === "uploading" && "opacity-60"
                  )}
                >
                  {attachment.status === "uploading" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isError ? (
                    <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                  <span className="max-w-[120px] truncate">{attachment.filename}</span>
                  {isError ? (
                    <span className="text-destructive">Failed</span>
                  ) : (
                    <span className="text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
                  )}
                  {attachment.status !== "uploading" && (
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      className="ml-1 hover:text-destructive"
                      aria-label={`Remove ${attachment.filename}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )

              if (isError) {
                // Show specific error for 4xx (user-actionable), generic for 5xx (server errors)
                const isServerError =
                  !attachment.error ||
                  attachment.error === "Internal server error" ||
                  attachment.error === "Upload failed"

                return (
                  <Tooltip key={attachment.id}>
                    <TooltipTrigger asChild>{attachmentChip}</TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="font-medium">Upload failed</p>
                      {isServerError ? (
                        <p className="text-muted-foreground">
                          We couldn't upload this file. Please remove it and try again, or contact support if the
                          problem persists.
                        </p>
                      ) : (
                        <p className="text-muted-foreground">{attachment.error}</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )
              }

              return <div key={attachment.id}>{attachmentChip}</div>
            })}
          </div>
        )}

        <div className="flex gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            disabled={isSending}
          />

          {/* Upload button - works for both drafts and regular streams */}
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
          {hasFailedFiles ? (
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
