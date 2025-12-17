import { useState, useCallback, useRef, useEffect } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useMessageService } from "@/contexts"
import { streamKeys } from "@/hooks"
import { db } from "@/db"
import type { StreamEvent } from "@/types/domain"

interface MessageInputProps {
  workspaceId: string
  streamId: string
}

export function MessageInput({ workspaceId, streamId }: MessageInputProps) {
  const [content, setContent] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messageService = useMessageService()
  const queryClient = useQueryClient()

  // Auto-focus on mount and when streamId changes
  useEffect(() => {
    textareaRef.current?.focus()
  }, [streamId])

  const sendMutation = useMutation({
    mutationFn: async (messageContent: string) => {
      // Generate client-side ID for optimistic update
      const clientId = generateClientId()
      const now = new Date().toISOString()

      // Create optimistic event
      const optimisticEvent: StreamEvent = {
        id: clientId,
        streamId,
        sequence: "0", // Placeholder, will be replaced
        eventType: "message_created",
        payload: {
          messageId: clientId,
          content: messageContent,
          contentFormat: "markdown",
        },
        actorId: "current_user", // Will be replaced with actual user
        actorType: "user",
        createdAt: now,
      }

      // Add to pending messages queue (persists across refresh)
      await db.pendingMessages.add({
        clientId,
        workspaceId,
        streamId,
        content: messageContent,
        contentFormat: "markdown",
        createdAt: Date.now(),
        retryCount: 0,
      })

      // Add optimistic event to cache
      await db.events.add({
        ...optimisticEvent,
        _clientId: clientId,
        _status: "pending",
        _cachedAt: Date.now(),
      })

      // Update query cache for immediate UI update
      queryClient.setQueryData(
        streamKeys.bootstrap(workspaceId, streamId),
        (old: unknown) => {
          if (!old || typeof old !== "object") return old
          const bootstrap = old as { events: StreamEvent[] }
          return {
            ...bootstrap,
            events: [...bootstrap.events, optimisticEvent],
          }
        },
      )

      try {
        // Send to server
        const message = await messageService.create(workspaceId, streamId, {
          streamId,
          content: messageContent,
          contentFormat: "markdown",
        })

        // Remove from pending queue
        await db.pendingMessages.delete(clientId)

        // Update the optimistic event with real data
        await db.events.delete(clientId)

        return message
      } catch (error) {
        // Mark as failed but keep in queue for retry
        await db.events.update(clientId, { _status: "failed" })
        throw error
      }
    },
    onSuccess: () => {
      // Invalidate to get fresh data with server-assigned IDs
      queryClient.invalidateQueries({
        queryKey: streamKeys.bootstrap(workspaceId, streamId),
      })
    },
  })

  const handleSubmit = useCallback(() => {
    const trimmed = content.trim()
    if (!trimmed || sendMutation.isPending) return

    sendMutation.mutate(trimmed)
    setContent("")
    textareaRef.current?.focus()
  }, [content, sendMutation])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd/Ctrl + Enter to send
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  return (
    <div className="border-t p-4">
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Cmd+Enter to send)"
          className="min-h-[80px] resize-none"
          disabled={sendMutation.isPending}
        />
        <Button
          onClick={handleSubmit}
          disabled={!content.trim() || sendMutation.isPending}
          className="self-end"
        >
          {sendMutation.isPending ? "Sending..." : "Send"}
        </Button>
      </div>
      {sendMutation.isError && (
        <p className="mt-2 text-sm text-destructive">
          Failed to send message. It will be retried automatically.
        </p>
      )}
    </div>
  )
}

function generateClientId(): string {
  // Simple ULID-like ID generator for client-side
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `temp_${timestamp}${random}`
}
