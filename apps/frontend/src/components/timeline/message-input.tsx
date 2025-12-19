import { useState, useCallback, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useDraftMessage, getDraftMessageKey, useStreamOrDraft } from "@/hooks"

interface MessageInputProps {
  workspaceId: string
  streamId: string
}

export function MessageInput({ workspaceId, streamId }: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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
  const wasJustSending = useRef(false)

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

  // Re-initialize after stream change if there's a saved draft
  useEffect(() => {
    if (!hasInitialized.current && savedDraft) {
      setContent(savedDraft)
      hasInitialized.current = true
    }
  }, [savedDraft, streamId])

  // Auto-focus on mount and when streamId changes
  useEffect(() => {
    textareaRef.current?.focus()
  }, [streamId])

  // Restore focus after sending completes (when textarea is re-enabled)
  useEffect(() => {
    if (wasJustSending.current && !isSending) {
      textareaRef.current?.focus()
    }
    wasJustSending.current = isSending
  }, [isSending])

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Enter to send, Shift+Enter for newline
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  return (
    <div className="border-t p-4">
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          className="min-h-[80px] resize-none"
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
