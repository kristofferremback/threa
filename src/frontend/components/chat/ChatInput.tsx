import { useState, type FormEvent } from "react"
import { Send } from "lucide-react"
import { Button, Input } from "../ui"

interface ChatInputProps {
  onSend: (message: string) => Promise<void>
  placeholder?: string
  disabled?: boolean
}

export function ChatInput({ onSend, placeholder = "Type a message...", disabled = false }: ChatInputProps) {
  const [message, setMessage] = useState("")
  const [isSending, setIsSending] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!message.trim() || isSending || disabled) return

    const content = message.trim()
    setMessage("") // Clear immediately for better UX
    setIsSending(true)

    try {
      await onSend(content)
    } catch {
      // Restore message on error
      setMessage(content)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 flex-shrink-0" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <div className="flex gap-2">
        <Input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={!message.trim() || disabled}
          loading={isSending}
          icon={!isSending && <Send className="h-4 w-4" />}
        />
      </div>
    </form>
  )
}
