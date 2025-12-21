import { useState, useCallback, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { RichEditor } from "@/components/editor"
import { Button } from "@/components/ui/button"
import { useDraftMessage, getDraftMessageKey, useStreamOrDraft } from "@/hooks"

interface MessageInputProps {
  workspaceId: string
  streamId: string
}

export function MessageInput({ workspaceId, streamId }: MessageInputProps) {
  const navigate = useNavigate()
  const { sendMessage } = useStreamOrDraft(workspaceId, streamId)

  // Draft message persistence
  const draftKey = getDraftMessageKey({ type: "stream", streamId })
  const { content: savedDraft, saveDraftDebounced, clearDraft } = useDraftMessage(workspaceId, draftKey)

  // Local state for immediate UI updates
  const [content, setContent] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasInitialized = useRef(false)

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
  }, [streamId])

  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent)
      saveDraftDebounced(newContent)
    },
    [saveDraftDebounced]
  )

  const handleSubmit = useCallback(async () => {
    const trimmed = content.trim()
    if (!trimmed || isSending) return

    setIsSending(true)
    setError(null)

    // Clear input immediately for responsiveness
    setContent("")
    clearDraft()

    try {
      const result = await sendMessage({ content: trimmed, contentFormat: "markdown" })
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
  }, [content, isSending, sendMessage, navigate, clearDraft])

  return (
    <div className="border-t p-4">
      <div className="flex gap-2">
        <RichEditor
          value={content}
          onChange={handleContentChange}
          onSubmit={handleSubmit}
          placeholder="Type a message... (Cmd+Enter to send)"
          disabled={isSending}
        />
        <Button onClick={handleSubmit} disabled={!content.trim() || isSending} className="self-end">
          {isSending ? "Sending..." : "Send"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
