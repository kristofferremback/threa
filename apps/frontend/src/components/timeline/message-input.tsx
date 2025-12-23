import { useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useDraftComposer, getDraftMessageKey, useStreamOrDraft } from "@/hooks"
import { MessageComposer } from "@/components/composer"

interface MessageInputProps {
  workspaceId: string
  streamId: string
}

export function MessageInput({ workspaceId, streamId }: MessageInputProps) {
  const navigate = useNavigate()
  const { sendMessage } = useStreamOrDraft(workspaceId, streamId)
  const draftKey = getDraftMessageKey({ type: "stream", streamId })

  const composer = useDraftComposer({ workspaceId, draftKey, scopeId: streamId })
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(async () => {
    if (!composer.canSend) return

    composer.setIsSending(true)
    setError(null)

    const trimmed = composer.content.trim()
    const attachmentIds = composer.uploadedIds

    // Clear input immediately for responsiveness
    composer.setContent("")
    composer.clearDraft()
    composer.clearAttachments()

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
      composer.setIsSending(false)
    }
  }, [composer, sendMessage, navigate])

  return (
    <div className="border-t p-4">
      <MessageComposer
        content={composer.content}
        onContentChange={composer.handleContentChange}
        pendingAttachments={composer.pendingAttachments}
        onRemoveAttachment={composer.handleRemoveAttachment}
        fileInputRef={composer.fileInputRef}
        onFileSelect={composer.handleFileSelect}
        onSubmit={handleSubmit}
        canSubmit={composer.canSend}
        isSubmitting={composer.isSending}
        hasFailed={composer.hasFailed}
        placeholder="Type a message... (Cmd+Enter to send)"
      />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
