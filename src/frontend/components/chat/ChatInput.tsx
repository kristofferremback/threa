import { useState, useRef, type FormEvent } from "react"
import { Send } from "lucide-react"
import { Button } from "../ui"
import { RichTextEditor, type RichTextEditorRef } from "./RichTextEditor"
import type { MessageMention } from "../../types"

interface ChatInputProps {
  onSend: (message: string, mentions?: MessageMention[]) => Promise<void>
  placeholder?: string
  disabled?: boolean
  users?: Array<{ id: string; name: string; email: string }>
  channels?: Array<{ id: string; name: string; slug: string | null }>
}

export function ChatInput({
  onSend,
  placeholder = "Type a message...",
  disabled = false,
  users = [],
  channels = [],
}: ChatInputProps) {
  const [isSending, setIsSending] = useState(false)
  const editorRef = useRef<RichTextEditorRef>(null)

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault()

    const content = editorRef.current?.getContent()?.trim()
    if (!content || isSending || disabled) return

    const mentions = editorRef.current?.getMentions() || []

    // Clear and immediately refocus to maintain cursor position
    editorRef.current?.clear()
    editorRef.current?.focus()

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

  return (
    <form onSubmit={handleSubmit} className="p-4 flex-shrink-0" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <div className="flex gap-2 items-end">
        <RichTextEditor
          ref={editorRef}
          placeholder={placeholder}
          disabled={disabled || isSending}
          onSubmit={handleSubmit}
          className="flex-1"
          autofocus
          users={users}
          channels={channels}
        />
        <Button
          type="submit"
          disabled={disabled}
          loading={isSending}
          icon={!isSending && <Send className="h-4 w-4" />}
          style={{ alignSelf: "flex-end", marginBottom: "2px" }}
        />
      </div>
      <div className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
        <span className="opacity-60">
          <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ background: "var(--bg-tertiary)" }}>Enter</kbd>
          {" "}to send,{" "}
          <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ background: "var(--bg-tertiary)" }}>Shift</kbd>
          +
          <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ background: "var(--bg-tertiary)" }}>Enter</kbd>
          {" "}for newline • **bold** *italic* `code` @mentions #channels
        </span>
      </div>
    </form>
  )
}
