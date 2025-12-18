import { useState, useCallback, useRef, useEffect } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useMessageService, useStreamService } from "@/contexts"
import { streamKeys, useDraftScratchpads, workspaceKeys, useDraftMessage, getDraftMessageKey } from "@/hooks"
import { db } from "@/db"
import type { StreamEvent } from "@/types/domain"
import { StreamTypes } from "@/types/domain"

interface MessageInputProps {
  workspaceId: string
  streamId: string
  isDraft?: boolean
}

export function MessageInput({ workspaceId, streamId, isDraft = false }: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messageService = useMessageService()
  const streamService = useStreamService()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { deleteDraft } = useDraftScratchpads(workspaceId)

  // Draft message persistence
  const draftKey = getDraftMessageKey({ type: "stream", streamId })
  const { content: savedDraft, saveDraftDebounced, clearDraft } = useDraftMessage(workspaceId, draftKey)

  // Local state for immediate UI updates
  const [content, setContent] = useState("")
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

  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent)
      saveDraftDebounced(newContent)
    },
    [saveDraftDebounced],
  )

  const sendMutation = useMutation({
    mutationFn: async (messageContent: string) => {
      // For drafts: create stream first, then send message
      if (isDraft) {
        // Read draft directly from IndexedDB to get latest data (not stale hook cache)
        const draft = await db.draftScratchpads.get(streamId)
        const companionMode = draft?.companionMode ?? "on"

        // Create the stream on server
        const newStream = await streamService.create(workspaceId, {
          type: StreamTypes.SCRATCHPAD,
          displayName: draft?.displayName ?? undefined,
          companionMode,
        })

        // Send the message to the new stream
        await messageService.create(workspaceId, newStream.id, {
          streamId: newStream.id,
          content: messageContent,
          contentFormat: "markdown",
        })

        // Delete the draft
        await deleteDraft(streamId)

        // Invalidate queries to refresh sidebar
        queryClient.invalidateQueries({ queryKey: workspaceKeys.bootstrap(workspaceId) })

        // Return the new stream ID for navigation
        return { newStreamId: newStream.id }
      }

      // Regular message sending (not a draft)
      const clientId = generateClientId()
      const now = new Date().toISOString()

      const optimisticEvent: StreamEvent = {
        id: clientId,
        streamId,
        sequence: "0",
        eventType: "message_created",
        payload: {
          messageId: clientId,
          content: messageContent,
          contentFormat: "markdown",
        },
        actorId: "current_user",
        actorType: "user",
        createdAt: now,
      }

      await db.pendingMessages.add({
        clientId,
        workspaceId,
        streamId,
        content: messageContent,
        contentFormat: "markdown",
        createdAt: Date.now(),
        retryCount: 0,
      })

      await db.events.add({
        ...optimisticEvent,
        _clientId: clientId,
        _status: "pending",
        _cachedAt: Date.now(),
      })

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
        const message = await messageService.create(workspaceId, streamId, {
          streamId,
          content: messageContent,
          contentFormat: "markdown",
        })

        await db.pendingMessages.delete(clientId)
        await db.events.delete(clientId)

        return { message }
      } catch (error) {
        await db.events.update(clientId, { _status: "failed" })
        throw error
      }
    },
    onSuccess: (result) => {
      if (result && "newStreamId" in result) {
        // Navigate to the new stream (draft was converted)
        navigate(`/w/${workspaceId}/s/${result.newStreamId}`)
      } else {
        // Invalidate to get fresh data with server-assigned IDs
        queryClient.invalidateQueries({
          queryKey: streamKeys.bootstrap(workspaceId, streamId),
        })
      }
    },
  })

  const handleSubmit = useCallback(() => {
    const trimmed = content.trim()
    if (!trimmed || sendMutation.isPending) return

    sendMutation.mutate(trimmed)
    setContent("")
    clearDraft()
    textareaRef.current?.focus()
  }, [content, sendMutation, clearDraft])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Enter to send, Shift+Enter for newline
      if (e.key === "Enter" && !e.shiftKey) {
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
          onChange={(e) => handleContentChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
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
