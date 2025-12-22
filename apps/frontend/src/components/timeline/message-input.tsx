import { useState, useCallback, useRef, useEffect, type ChangeEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Paperclip, X, Loader2, FileText, Image, File } from "lucide-react"
import { RichEditor } from "@/components/editor"
import { Button } from "@/components/ui/button"
import { useDraftMessage, getDraftMessageKey, useStreamOrDraft, isDraftId } from "@/hooks"
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
  const isDraft = isDraftId(streamId)

  // Draft message persistence
  const draftKey = getDraftMessageKey({ type: "stream", streamId })
  const { content: savedDraft, saveDraftDebounced, clearDraft } = useDraftMessage(workspaceId, draftKey)

  // Local state for immediate UI updates
  const [content, setContent] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const hasInitialized = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Initialize content from saved draft (only once per stream)
  useEffect(() => {
    if (!hasInitialized.current && savedDraft) {
      setContent(savedDraft)
      hasInitialized.current = true
    }
  }, [savedDraft])

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
          const attachment = await attachmentsApi.upload(workspaceId, streamId, file)

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
    [workspaceId, streamId]
  )

  const removeAttachment = useCallback(
    async (attachmentId: string) => {
      const attachment = pendingAttachments.find((a) => a.id === attachmentId)
      if (!attachment) return

      // Remove from UI immediately
      setPendingAttachments((prev) => prev.filter((a) => a.id !== attachmentId))

      // If it was successfully uploaded, delete from server
      if (attachment.status === "uploaded" && !attachmentId.startsWith("temp_")) {
        try {
          await attachmentsApi.delete(workspaceId, attachmentId)
        } catch {
          // Ignore - file will be cleaned up by server eventually
        }
      }
    },
    [pendingAttachments, workspaceId]
  )

  const uploadedAttachmentIds = pendingAttachments
    .filter((a) => a.status === "uploaded" && !a.id.startsWith("temp_"))
    .map((a) => a.id)

  const hasUploadingFiles = pendingAttachments.some((a) => a.status === "uploading")
  const canSend = (content.trim() || uploadedAttachmentIds.length > 0) && !isSending && !hasUploadingFiles

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
        navigate(result.navigateTo)
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
    <div className="border-t p-4">
      {/* Pending attachments */}
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {pendingAttachments.map((attachment) => {
            const Icon = getFileIcon(attachment.mimeType)
            return (
              <div
                key={attachment.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2 py-1 text-xs",
                  attachment.status === "error" && "border-destructive bg-destructive/10",
                  attachment.status === "uploading" && "opacity-60"
                )}
              >
                {attachment.status === "uploading" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
                <span className="max-w-[120px] truncate">{attachment.filename}</span>
                <span className="text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
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
          disabled={isDraft || isSending}
        />

        {/* Upload button - disabled for drafts since we need a real streamId */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="self-end shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={isDraft || isSending}
          title={isDraft ? "Send a message first to enable file uploads" : "Attach files"}
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
        <Button onClick={handleSubmit} disabled={!canSend} className="self-end">
          {isSending ? "Sending..." : "Send"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
