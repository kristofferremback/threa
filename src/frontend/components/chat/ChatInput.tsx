import { useState, useRef, useEffect, useMemo, type FormEvent } from "react"
import { Send, FileText } from "lucide-react"
import { Button } from "../ui"
import { RichTextEditor, type RichTextEditorRef, type ExtractedMention } from "./RichTextEditor"
import type { MessageMention } from "../../types"
import { saveDraft, getDraft, clearDraft } from "../../lib/offline"

interface ChatInputProps {
  onSend: (message: string, mentions?: MessageMention[]) => Promise<void>
  placeholder?: string
  disabled?: boolean
  users?: Array<{ id: string; name: string; email: string }>
  channels?: Array<{ id: string; name: string; slug: string | null }>
  agents?: Array<{ id: string; name: string; slug: string; description: string; avatarEmoji: string | null }>
  streamId?: string
}

// Debounce helper
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timeout: ReturnType<typeof setTimeout> | null = null
  return ((...args: unknown[]) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => fn(...args), ms)
  }) as T
}

export function ChatInput({
  onSend,
  placeholder = "Type a message...",
  disabled = false,
  users = [],
  channels = [],
  agents = [],
  streamId,
}: ChatInputProps) {
  const [isSending, setIsSending] = useState(false)
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved">("idle")
  const [initialContent, setInitialContent] = useState("")
  const [initialMentions, setInitialMentions] = useState<ExtractedMention[]>([])
  const [draftLoaded, setDraftLoaded] = useState(false)
  const editorRef = useRef<RichTextEditorRef>(null)
  const currentStreamIdRef = useRef(streamId)

  // Load draft when streamId changes
  useEffect(() => {
    if (!streamId) {
      setInitialContent("")
      setInitialMentions([])
      setDraftLoaded(true)
      return
    }

    // Track if this effect is still relevant
    let cancelled = false
    currentStreamIdRef.current = streamId

    // Reset state for new stream
    setDraftLoaded(false)
    setInitialContent("")
    setInitialMentions([])
    setDraftStatus("idle")

    // Load draft with retry on failure
    const loadDraft = async (retryCount = 0) => {
      try {
        const draft = await getDraft(streamId)
        if (cancelled || currentStreamIdRef.current !== streamId) return

        if (draft && draft.content) {
          setInitialContent(draft.content)
          setInitialMentions(draft.mentions as ExtractedMention[])
          setDraftStatus("saved")
        }
        setDraftLoaded(true)
      } catch (err) {
        // Retry once on error (handles stale IndexedDB connections)
        if (retryCount < 1) {
          console.warn("[ChatInput] Draft load failed, retrying:", err)
          setTimeout(() => loadDraft(retryCount + 1), 100)
        } else {
          console.error("[ChatInput] Draft load failed after retry:", err)
          if (cancelled || currentStreamIdRef.current !== streamId) return
          setDraftLoaded(true)
        }
      }
    }

    loadDraft()

    return () => {
      cancelled = true
    }
  }, [streamId])

  // Debounced save function
  const debouncedSave = useMemo(
    () =>
      debounce((content: string, mentions: ExtractedMention[]) => {
        if (!streamId) return

        const trimmed = content.trim()
        if (!trimmed) {
          clearDraft(streamId)
          setDraftStatus("idle")
          return
        }

        setDraftStatus("saving")
        saveDraft(streamId, content, mentions).then(() => {
          setDraftStatus("saved")
          // Auto-hide the "saved" indicator after 2 seconds
          setTimeout(() => {
            setDraftStatus((current) => (current === "saved" ? "idle" : current))
          }, 2000)
        })
      }, 500),
    [streamId],
  )

  // Handle editor changes - save draft
  const handleChange = (content: string) => {
    if (!streamId) return
    const mentions = editorRef.current?.getMentions() || []
    debouncedSave(content, mentions)
  }

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault()

    const content = editorRef.current?.getContent()?.trim()
    if (!content || isSending || disabled) return

    const mentions = editorRef.current?.getMentions() || []

    // Clear and immediately refocus to maintain cursor position
    editorRef.current?.clear()
    editorRef.current?.focus()

    // Clear draft
    if (streamId) {
      clearDraft(streamId)
      setDraftStatus("idle")
    }

    setIsSending(true)

    try {
      await onSend(content, mentions)
    } catch {
      // Error is handled by onSend
    } finally {
      setIsSending(false)
      // Ensure focus is maintained after send completes
      requestAnimationFrame(() => {
        editorRef.current?.focus()
      })
    }
  }

  // Don't render until draft is loaded to prevent flash
  if (!draftLoaded && streamId) {
    return (
      <div className="p-4 flex-shrink-0" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <div
          className="px-4 py-2.5 text-sm rounded-lg"
          style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)" }}
        >
          <span style={{ color: "var(--text-muted)" }}>Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 flex-shrink-0" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <div className="flex gap-2 items-end">
        <RichTextEditor
          ref={editorRef}
          placeholder={placeholder}
          disabled={disabled || isSending}
          onSubmit={handleSubmit}
          onChange={handleChange}
          className="flex-1"
          autofocus
          users={users}
          channels={channels}
          agents={agents}
          initialContent={initialContent}
          initialMentions={initialMentions}
          key={streamId}
        />
        <Button
          type="submit"
          disabled={disabled}
          loading={isSending}
          icon={!isSending && <Send className="h-4 w-4" />}
          style={{ alignSelf: "flex-end", marginBottom: "2px" }}
        />
      </div>
      <div className="mt-1.5 text-xs flex items-center justify-between" style={{ color: "var(--text-muted)" }}>
        <span className="opacity-60">
          <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ background: "var(--bg-tertiary)" }}>
            Enter
          </kbd>{" "}
          to send,{" "}
          <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ background: "var(--bg-tertiary)" }}>
            Shift
          </kbd>
          +
          <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ background: "var(--bg-tertiary)" }}>
            Enter
          </kbd>{" "}
          for newline • **bold** *italic* `code` @mentions #channels
        </span>
        {/* Always render to prevent layout jumps - use opacity to hide/show */}
        <span
          className="flex items-center gap-1 text-[10px] transition-opacity duration-150"
          style={{ opacity: draftStatus === "idle" ? 0 : 0.6 }}
        >
          {draftStatus === "saving" ? (
            <span className="animate-pulse">Saving...</span>
          ) : (
            <>
              <FileText className="h-3 w-3" />
              Draft saved
            </>
          )}
        </span>
      </div>
    </form>
  )
}
