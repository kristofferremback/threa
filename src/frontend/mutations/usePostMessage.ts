/**
 * Post Message Mutation Hook
 *
 * Handles posting messages with optimistic updates and offline support.
 * Uses an outbox pattern: messages are stored BEFORE sending and removed
 * only after server confirmation.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { streamApi } from "../../shared/api"
import { eventKeys } from "../queries/useEventsQuery"
import type { StreamEvent, Mention, Stream } from "../types"
import type { PostMessageInput, EventsResponse } from "../../shared/api/types"
import {
  addToOutbox,
  removeFromOutbox,
  markAsSending,
  markAsFailed,
  generateTempId,
  getStreamOutboxMessages,
  type OutboxMessage,
} from "../lib/message-outbox"

// Re-export for backwards compatibility and use in other modules
export {
  getOutboxMessages,
  getStreamOutboxMessages,
  removeFromOutbox,
  getRetryableMessages,
  type OutboxMessage,
} from "../lib/message-outbox"

interface UsePostMessageOptions {
  workspaceId: string
  streamId: string | undefined
  currentUserId?: string
  currentUserEmail?: string
  onSuccess?: (event: StreamEvent, stream?: Stream) => void
  onError?: (error: Error) => void
}

/**
 * Convert an outbox message to a StreamEvent for display
 */
export function outboxToEvent(msg: OutboxMessage): StreamEvent {
  return {
    id: msg.id,
    streamId: msg.streamId,
    eventType: "message",
    actorId: msg.actorId,
    actorEmail: msg.actorEmail,
    content: msg.content,
    mentions: msg.mentions,
    createdAt: msg.createdAt,
    pending: msg.status === "pending" || msg.status === "sending",
    sendFailed: msg.status === "failed",
  }
}

/**
 * Hook to post messages with optimistic updates.
 *
 * Shows message immediately in UI, syncs with server in background.
 * Works offline - mutations are queued in outbox and sent when online.
 */
export function usePostMessage({
  workspaceId,
  streamId,
  currentUserId = "",
  currentUserEmail = "",
  onSuccess,
  onError,
}: UsePostMessageOptions) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (input: PostMessageInput & { _tempId?: string }) => {
      if (!streamId) throw new Error("No stream ID")

      const tempId = input._tempId
      if (tempId) {
        markAsSending(tempId)
      }

      // For pending threads, pass parent info
      // Use tempId as clientMessageId for server-side idempotency
      const data: PostMessageInput = {
        content: input.content,
        mentions: input.mentions,
        parentEventId: streamId.startsWith("event_") ? streamId : input.parentEventId,
        parentStreamId: input.parentStreamId,
        clientMessageId: tempId,
      }

      const result = await streamApi.postMessage(
        workspaceId,
        streamId.startsWith("event_") ? "pending" : streamId,
        data
      )

      return { ...result, _tempId: tempId }
    },
    onMutate: async (input) => {
      if (!streamId) return { tempId: "" }

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: eventKeys.stream(workspaceId, streamId) })

      // Snapshot previous value
      const previousEvents = queryClient.getQueryData<{ pages: EventsResponse[] }>(
        eventKeys.stream(workspaceId, streamId)
      )

      // tempId is always provided (generated in postMessage or passed in retryMessage)
      const tempId = input._tempId!

      // Store in outbox FIRST (before any network call) - only for new messages
      const existingInOutbox = getStreamOutboxMessages(workspaceId, streamId).some((m) => m.id === tempId)
      if (!existingInOutbox) {
        // For pending threads (streamId starts with "event_"), store parent info
        const isPendingThread = streamId.startsWith("event_")
        addToOutbox({
          id: tempId,
          workspaceId,
          streamId,
          content: input.content,
          mentions: input.mentions,
          actorId: currentUserId,
          actorEmail: currentUserEmail,
          createdAt: new Date().toISOString(),
          parentEventId: isPendingThread ? streamId : input.parentEventId,
          parentStreamId: input.parentStreamId,
        })
      }

      // Mark as sending immediately to prevent duplicate sends from retry logic
      markAsSending(tempId)

      // Create optimistic event
      const optimisticEvent: StreamEvent = {
        id: tempId,
        streamId,
        eventType: "message",
        actorId: currentUserId,
        actorEmail: currentUserEmail,
        content: input.content,
        mentions: input.mentions,
        createdAt: new Date().toISOString(),
        pending: true,
      }

      // Add optimistic event to cache (if not already there from retry)
      queryClient.setQueryData<{ pages: EventsResponse[]; pageParams: unknown[] }>(
        eventKeys.stream(workspaceId, streamId),
        (old) => {
          if (!old) {
            return {
              pages: [{ events: [optimisticEvent], hasMore: false }],
              pageParams: [undefined],
            }
          }

          // Check if already in cache (retry case) - filter out null events
          const allEvents = old.pages.flatMap((p) => p.events).filter((e): e is StreamEvent => e != null)
          if (allEvents.some((e) => e.id === tempId)) {
            // Update existing event to pending state
            const pages = old.pages.map((page) => ({
              ...page,
              events: page.events.filter((e): e is StreamEvent => e != null).map((e) =>
                e.id === tempId ? { ...e, pending: true, sendFailed: false } : e
              ),
            }))
            return { ...old, pages }
          }

          // Add to the last page
          const pages = old.pages.map((page, i) => {
            if (i === old.pages.length - 1) {
              return { ...page, events: [...page.events, optimisticEvent] }
            }
            return page
          })

          return { ...old, pages }
        }
      )

      return { tempId, previousEvents }
    },
    onError: (error, input, context) => {
      // Mark as failed in outbox and UI
      if (context?.tempId && streamId) {
        markAsFailed(context.tempId, error.message)

        queryClient.setQueryData<{ pages: EventsResponse[]; pageParams: unknown[] }>(
          eventKeys.stream(workspaceId, streamId),
          (old) => {
            if (!old) return old

            const pages = old.pages.map((page) => ({
              ...page,
              events: page.events.filter((e): e is StreamEvent => e != null).map((e) =>
                e.id === context.tempId ? { ...e, pending: false, sendFailed: true } : e
              ),
            }))

            return { ...old, pages }
          }
        )
      }
      onError?.(error)
    },
    onSuccess: (response, _input, context) => {
      // Remove from outbox and replace optimistic with real event
      if (streamId && context?.tempId) {
        removeFromOutbox(context.tempId)

        queryClient.setQueryData<{ pages: EventsResponse[]; pageParams: unknown[] }>(
          eventKeys.stream(workspaceId, streamId),
          (old) => {
            if (!old) return old

            const pages = old.pages.map((page) => ({
              ...page,
              events: page.events.filter((e): e is StreamEvent => e != null).map((e) => (e.id === context.tempId ? response.event : e)),
            }))

            return { ...old, pages }
          }
        )
      }

      onSuccess?.(response.event, response.stream)
    },
    // Don't use networkMode: offlineFirst - we handle offline ourselves
    // Retry is handled manually via outbox
    retry: false,
  })

  /**
   * Post a new message
   */
  const postMessage = async (content: string, mentions?: Mention[]) => {
    // Generate tempId here so both mutationFn and onMutate have access to it
    const tempId = generateTempId()
    return mutation.mutateAsync({ content, mentions, _tempId: tempId })
  }

  /**
   * Retry a failed message from the outbox
   */
  const retryMessage = async (tempId: string) => {
    const outboxMessages = getStreamOutboxMessages(workspaceId, streamId || "")
    const message = outboxMessages.find((m) => m.id === tempId)

    if (!message) {
      console.warn("Message not found in outbox:", tempId)
      return
    }

    return mutation.mutateAsync({
      content: message.content,
      mentions: message.mentions,
      parentEventId: message.parentEventId,
      parentStreamId: message.parentStreamId,
      _tempId: tempId,
    })
  }

  return {
    postMessage,
    retryMessage,
    isPending: mutation.isPending,
    error: mutation.error ? mutation.error.message : null,
  }
}
