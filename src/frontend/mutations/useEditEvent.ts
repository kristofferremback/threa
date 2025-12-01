/**
 * Edit Event Mutation Hook
 *
 * Handles editing events with optimistic updates.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { streamApi } from "../../shared/api"
import { eventKeys } from "../queries/useEventsQuery"
import type { StreamEvent, Mention } from "../types"
import type { EditMessageInput, EventsResponse } from "../../shared/api/types"

interface UseEditEventOptions {
  workspaceId: string
  streamId: string | undefined
  onSuccess?: (event: StreamEvent) => void
  onError?: (error: Error) => void
}

/**
 * Hook to edit events with optimistic updates.
 */
export function useEditEvent({ workspaceId, streamId, onSuccess, onError }: UseEditEventOptions) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async ({ eventId, content, mentions }: { eventId: string; content: string; mentions?: Mention[] }) => {
      if (!streamId) throw new Error("No stream ID")
      return streamApi.editEvent(workspaceId, streamId, eventId, { content, mentions })
    },
    onMutate: async ({ eventId, content, mentions }) => {
      if (!streamId) return {}

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: eventKeys.stream(workspaceId, streamId) })

      // Snapshot previous value
      const previousEvents = queryClient.getQueryData<{ pages: EventsResponse[] }>(
        eventKeys.stream(workspaceId, streamId)
      )

      // Optimistically update the event
      queryClient.setQueryData<{ pages: EventsResponse[]; pageParams: unknown[] }>(
        eventKeys.stream(workspaceId, streamId),
        (old) => {
          if (!old) return old

          const pages = old.pages.map((page) => ({
            ...page,
            events: page.events.map((e) =>
              e.id === eventId
                ? {
                    ...e,
                    content,
                    mentions,
                    isEdited: true,
                    editedAt: new Date().toISOString(),
                  }
                : e
            ),
          }))

          return { ...old, pages }
        }
      )

      return { previousEvents }
    },
    onError: (error, _input, context) => {
      // Revert on error
      if (context?.previousEvents && streamId) {
        queryClient.setQueryData(eventKeys.stream(workspaceId, streamId), context.previousEvents)
      }
      onError?.(error)
    },
    onSuccess: (event) => {
      onSuccess?.(event)
    },
    networkMode: "offlineFirst",
    retry: 3,
  })

  const editEvent = async (eventId: string, content: string, mentions?: Mention[]) => {
    return mutation.mutateAsync({ eventId, content, mentions })
  }

  return {
    editEvent,
    isPending: mutation.isPending,
    error: mutation.error ? mutation.error.message : null,
  }
}
