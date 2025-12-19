import { useCallback } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { db } from "@/db"
import { useStreamService, useMessageService } from "@/contexts"
import { useStreamBootstrap, streamKeys } from "./use-streams"
import { workspaceKeys } from "./use-workspaces"
import type { StreamType, CompanionMode, ContentFormat, StreamEvent } from "@threa/types"
import { StreamTypes } from "@threa/types"

function generateClientId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `temp_${timestamp}${random}`
}

export function isDraftId(id: string): boolean {
  return id.startsWith("draft_")
}

export interface VirtualStream {
  id: string
  workspaceId: string
  type: StreamType
  displayName: string | null
  companionMode: CompanionMode
  isDraft: boolean
}

export interface SendMessageInput {
  content: string
  contentFormat: ContentFormat
}

export interface UseStreamOrDraftReturn {
  stream: VirtualStream | undefined
  isLoading: boolean
  isDraft: boolean

  rename: (newName: string) => Promise<void>
  archive: () => Promise<void>
  sendMessage: (input: SendMessageInput) => Promise<{ navigateTo?: string }>
}

/**
 * Implementation for draft streams (stored in IndexedDB).
 */
function useDraftStream(workspaceId: string, streamId: string, enabled: boolean): UseStreamOrDraftReturn {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const streamService = useStreamService()
  const messageService = useMessageService()

  const draft = useLiveQuery(() => (enabled ? db.draftScratchpads.get(streamId) : undefined), [enabled, streamId])

  const stream: VirtualStream | undefined = draft
    ? {
        id: draft.id,
        workspaceId: draft.workspaceId,
        type: StreamTypes.SCRATCHPAD,
        displayName: draft.displayName,
        companionMode: draft.companionMode,
        isDraft: true,
      }
    : undefined

  const rename = useCallback(
    async (newName: string) => {
      await db.draftScratchpads.update(streamId, { displayName: newName })
    },
    [streamId]
  )

  const archive = useCallback(async () => {
    await db.draftScratchpads.delete(streamId)
    navigate(`/w/${workspaceId}`)
  }, [streamId, workspaceId, navigate])

  const sendMessage = useCallback(
    async (input: SendMessageInput): Promise<{ navigateTo?: string }> => {
      // Promote draft to real stream
      const draftData = await db.draftScratchpads.get(streamId)
      const companionMode = draftData?.companionMode ?? "on"

      const newStream = await streamService.create(workspaceId, {
        type: StreamTypes.SCRATCHPAD,
        displayName: draftData?.displayName ?? undefined,
        companionMode,
      })

      await messageService.create(workspaceId, newStream.id, {
        streamId: newStream.id,
        content: input.content,
        contentFormat: input.contentFormat,
      })

      await db.draftScratchpads.delete(streamId)

      queryClient.invalidateQueries({ queryKey: workspaceKeys.bootstrap(workspaceId) })

      return { navigateTo: `/w/${workspaceId}/s/${newStream.id}` }
    },
    [streamId, workspaceId, streamService, messageService, queryClient]
  )

  return {
    stream,
    isLoading: enabled && draft === undefined,
    isDraft: true,
    rename,
    archive,
    sendMessage,
  }
}

/**
 * Implementation for real streams (stored on server).
 */
function useRealStream(workspaceId: string, streamId: string, enabled: boolean): UseStreamOrDraftReturn {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const streamService = useStreamService()
  const messageService = useMessageService()

  const { data: bootstrap, isLoading } = useStreamBootstrap(workspaceId, streamId, { enabled })

  const stream: VirtualStream | undefined = bootstrap?.stream
    ? {
        id: bootstrap.stream.id,
        workspaceId: bootstrap.stream.workspaceId,
        type: bootstrap.stream.type,
        displayName: bootstrap.stream.displayName,
        companionMode: bootstrap.stream.companionMode,
        isDraft: false,
      }
    : undefined

  const rename = useCallback(
    async (newName: string) => {
      const updatedStream = await streamService.update(workspaceId, streamId, {
        displayName: newName,
      })

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        return { ...old, stream: updatedStream }
      })

      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const wsBootstrap = old as { streams?: Array<{ id: string }> }
        if (!wsBootstrap.streams) return old
        return {
          ...wsBootstrap,
          streams: wsBootstrap.streams.map((s) => (s.id === streamId ? updatedStream : s)),
        }
      })
    },
    [streamId, workspaceId, streamService, queryClient]
  )

  const archive = useCallback(async () => {
    await streamService.archive(workspaceId, streamId)

    queryClient.removeQueries({ queryKey: streamKeys.detail(workspaceId, streamId) })
    queryClient.removeQueries({ queryKey: streamKeys.bootstrap(workspaceId, streamId) })

    queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
      if (!old || typeof old !== "object") return old
      const wsBootstrap = old as { streams?: Array<{ id: string }> }
      if (!wsBootstrap.streams) return old
      return {
        ...wsBootstrap,
        streams: wsBootstrap.streams.filter((s) => s.id !== streamId),
      }
    })

    navigate(`/w/${workspaceId}`)
  }, [streamId, workspaceId, streamService, queryClient, navigate])

  const sendMessage = useCallback(
    async (input: SendMessageInput): Promise<{ navigateTo?: string }> => {
      const clientId = generateClientId()
      const now = new Date().toISOString()

      const optimisticEvent: StreamEvent = {
        id: clientId,
        streamId,
        sequence: "0",
        eventType: "message_created",
        payload: {
          messageId: clientId,
          content: input.content,
          contentFormat: input.contentFormat,
        },
        actorId: "current_user",
        actorType: "user",
        createdAt: now,
      }

      // Add to pending and cache optimistically
      await db.pendingMessages.add({
        clientId,
        workspaceId,
        streamId,
        content: input.content,
        contentFormat: input.contentFormat,
        createdAt: Date.now(),
        retryCount: 0,
      })

      await db.events.add({
        ...optimisticEvent,
        _clientId: clientId,
        _status: "pending",
        _cachedAt: Date.now(),
      })

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { events: StreamEvent[] }
        return {
          ...bootstrap,
          events: [...bootstrap.events, optimisticEvent],
        }
      })

      try {
        await messageService.create(workspaceId, streamId, {
          streamId,
          content: input.content,
          contentFormat: input.contentFormat,
        })

        await db.pendingMessages.delete(clientId)
        await db.events.delete(clientId)
      } catch (err) {
        await db.events.update(clientId, { _status: "failed" })
        throw err
      }

      return {}
    },
    [streamId, workspaceId, messageService, queryClient]
  )

  return {
    stream,
    isLoading,
    isDraft: false,
    rename,
    archive,
    sendMessage,
  }
}

/**
 * Unified hook for working with both draft and real streams.
 *
 * Provides a consistent interface regardless of whether the stream
 * is a local draft (IndexedDB) or a persisted stream (server).
 */
export function useStreamOrDraft(workspaceId: string, streamId: string): UseStreamOrDraftReturn {
  const isDraft = isDraftId(streamId)

  // Call both implementations (React hook rules require consistent hook calls)
  // Each implementation no-ops when not enabled
  const draftResult = useDraftStream(workspaceId, streamId, isDraft)
  const realResult = useRealStream(workspaceId, streamId, !isDraft)

  return isDraft ? draftResult : realResult
}
