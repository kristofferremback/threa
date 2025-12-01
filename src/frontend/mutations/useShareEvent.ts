/**
 * Share Event Mutation Hook
 *
 * Handles sharing events to parent streams.
 */

import { useMutation } from "@tanstack/react-query"
import { streamApi } from "../../shared/api"
import type { StreamEvent } from "../types"

interface UseShareEventOptions {
  workspaceId: string
  streamId: string | undefined
  onSuccess?: (event: StreamEvent) => void
  onError?: (error: Error) => void
}

/**
 * Hook to share an event to the parent stream.
 */
export function useShareEvent({ workspaceId, streamId, onSuccess, onError }: UseShareEventOptions) {
  const mutation = useMutation({
    mutationFn: async (eventId: string) => {
      if (!streamId) throw new Error("No stream ID")
      return streamApi.shareEvent(workspaceId, streamId, eventId)
    },
    onSuccess: (event) => {
      onSuccess?.(event)
    },
    onError: (error) => {
      onError?.(error)
    },
    networkMode: "offlineFirst",
    retry: 3,
  })

  const shareEvent = async (eventId: string) => {
    return mutation.mutateAsync(eventId)
  }

  return {
    shareEvent,
    isPending: mutation.isPending,
    error: mutation.error ? mutation.error.message : null,
  }
}
