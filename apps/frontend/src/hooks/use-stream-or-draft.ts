import { useCallback, useEffect } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { db } from "@/db"
import { useStreamService, useMessageService, usePendingMessages } from "@/contexts"
import { useUser } from "@/auth"
import { useStreamBootstrap, streamKeys } from "./use-streams"
import { useWorkspaceBootstrap, workspaceKeys } from "./use-workspaces"
import { createOptimisticBootstrap, type AttachmentSummary } from "./create-optimistic-bootstrap"
import { serializeToMarkdown } from "@threa/prosemirror"
import type { StreamType, CompanionMode, StreamEvent, JSONContent, WorkspaceBootstrap } from "@threa/types"
import { StreamTypes, Visibilities, CompanionModes } from "@threa/types"

const DM_DRAFT_PREFIX = "draft_dm_"

function generateClientId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `temp_${timestamp}${random}`
}

export function isDraftId(id: string): boolean {
  return id.startsWith("draft_")
}

export function createDmDraftId(memberId: string): string {
  return `${DM_DRAFT_PREFIX}${memberId}`
}

export function isDmDraftId(id: string): boolean {
  return id.startsWith(DM_DRAFT_PREFIX)
}

export function getDmDraftMemberId(id: string): string | null {
  if (!isDmDraftId(id)) return null
  const memberId = id.slice(DM_DRAFT_PREFIX.length)
  return memberId.length > 0 ? memberId : null
}

export interface VirtualStream {
  id: string
  workspaceId: string
  type: StreamType
  slug?: string | null
  displayName: string | null
  companionMode: CompanionMode
  isDraft: boolean
  parentStreamId: string | null
  parentMessageId: string | null
  rootStreamId: string | null
  archivedAt: string | null
}

export interface SendMessageInput {
  contentJson: JSONContent
  attachmentIds?: string[]
  /** Full attachment info for optimistic UI - required when attachmentIds is provided */
  attachments?: AttachmentSummary[]
}

export interface UseStreamOrDraftReturn {
  stream: VirtualStream | undefined
  isLoading: boolean
  isDraft: boolean
  error: Error | null

  rename: (newName: string) => Promise<void>
  archive: () => Promise<void>
  unarchive?: () => Promise<void>
  sendMessage: (input: SendMessageInput) => Promise<{ navigateTo?: string; replace?: boolean }>
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
        parentStreamId: null,
        parentMessageId: null,
        rootStreamId: null,
        archivedAt: null,
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
    async (input: SendMessageInput): Promise<{ navigateTo?: string; replace?: boolean }> => {
      // Promote draft to real stream
      const draftData = await db.draftScratchpads.get(streamId)
      const companionMode = draftData?.companionMode ?? "on"

      const newStream = await streamService.create(workspaceId, {
        type: StreamTypes.SCRATCHPAD,
        displayName: draftData?.displayName ?? undefined,
        companionMode,
      })

      // Serialize JSON to markdown for API and optimistic UI
      const contentMarkdown = serializeToMarkdown(input.contentJson)

      const message = await messageService.create(workspaceId, newStream.id, {
        streamId: newStream.id,
        contentJson: input.contentJson,
        contentMarkdown,
        attachmentIds: input.attachmentIds,
      })

      await db.draftScratchpads.delete(streamId)

      // Pre-populate the new stream's cache so navigation is instant
      queryClient.setQueryData(
        streamKeys.bootstrap(workspaceId, newStream.id),
        createOptimisticBootstrap({
          stream: newStream,
          message,
          contentMarkdown,
          attachments: input.attachments,
        })
      )

      queryClient.invalidateQueries({ queryKey: workspaceKeys.bootstrap(workspaceId) })

      return { navigateTo: `/w/${workspaceId}/s/${newStream.id}`, replace: true }
    },
    [streamId, workspaceId, streamService, messageService, queryClient]
  )

  return {
    stream,
    isLoading: enabled && draft === undefined,
    isDraft: true,
    error: null,
    rename,
    archive,
    sendMessage,
  }
}

/**
 * Implementation for virtual DM drafts.
 * The stream is created lazily on first message via backend find-or-create.
 */
function useDraftDmStream(workspaceId: string, streamId: string, enabled: boolean): UseStreamOrDraftReturn {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const messageService = useMessageService()
  const user = useUser()
  const { data: wsBootstrap, isLoading } = useWorkspaceBootstrap(workspaceId)

  const targetMemberId = getDmDraftMemberId(streamId)
  const targetMember = wsBootstrap?.members.find((m) => m.id === targetMemberId) ?? null
  const targetMemberName = targetMember?.name ?? null
  const currentMemberId = wsBootstrap?.members.find((m) => m.userId === user?.id)?.id ?? null
  const existingDmStreamId =
    targetMemberId && currentMemberId
      ? wsBootstrap?.dmPeers?.find((peer) => peer.memberId === targetMemberId)?.streamId
      : null

  useEffect(() => {
    if (!enabled || !existingDmStreamId) return
    let cancelled = false
    const draftKey = `stream:${streamId}`
    const realStreamKey = `stream:${existingDmStreamId}`

    const migrateDraftAndNavigate = async () => {
      if (draftKey !== realStreamKey) {
        const draft = await db.draftMessages.get(draftKey)
        if (draft) {
          const existingDraft = await db.draftMessages.get(realStreamKey)
          if (!existingDraft || existingDraft.updatedAt < draft.updatedAt) {
            await db.draftMessages.put({ ...draft, id: realStreamKey })
          }
          await db.draftMessages.delete(draftKey)
        }
      }

      if (!cancelled) {
        navigate(`/w/${workspaceId}/s/${existingDmStreamId}`, { replace: true })
      }
    }

    void migrateDraftAndNavigate()

    return () => {
      cancelled = true
    }
  }, [enabled, existingDmStreamId, navigate, streamId, workspaceId])

  const stream: VirtualStream | undefined =
    enabled && targetMemberId
      ? {
          id: streamId,
          workspaceId,
          type: StreamTypes.DM,
          displayName: targetMember?.name ?? "Direct message",
          companionMode: "off",
          isDraft: true,
          parentStreamId: null,
          parentMessageId: null,
          rootStreamId: null,
          archivedAt: null,
        }
      : undefined

  const rename = useCallback(async () => {}, [])

  const archive = useCallback(async () => {
    await db.draftMessages.delete(`stream:${streamId}`)
    navigate(`/w/${workspaceId}`)
  }, [streamId, workspaceId, navigate])

  const sendMessage = useCallback(
    async (input: SendMessageInput): Promise<{ navigateTo?: string; replace?: boolean }> => {
      if (!targetMemberId) {
        throw new Error("Invalid DM draft target")
      }

      const contentMarkdown = serializeToMarkdown(input.contentJson)
      const message = await messageService.createDm(workspaceId, targetMemberId, {
        dmMemberId: targetMemberId,
        contentJson: input.contentJson,
        contentMarkdown,
        attachmentIds: input.attachmentIds,
      })

      // Keep sidebar state consistent immediately on sender side:
      // remove virtual DM draft and set viewer-specific DM name as soon as streamId is known.
      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old

        const hasPeer = (old.dmPeers ?? []).some(
          (peer) => peer.memberId === targetMemberId && peer.streamId === message.streamId
        )

        const streamExists = old.streams.some((stream) => stream.id === message.streamId)
        const optimisticStream = streamExists
          ? old.streams
          : [
              ...old.streams,
              {
                id: message.streamId,
                workspaceId,
                type: StreamTypes.DM,
                displayName: targetMemberName ?? "Direct message",
                slug: null,
                description: null,
                visibility: Visibilities.PRIVATE,
                parentStreamId: null,
                parentMessageId: null,
                rootStreamId: null,
                companionMode: CompanionModes.OFF,
                companionPersonaId: null,
                createdBy: message.authorId,
                createdAt: message.createdAt,
                updatedAt: message.createdAt,
                archivedAt: null,
                lastMessagePreview: {
                  authorId: message.authorId,
                  authorType: message.authorType,
                  content: message.contentMarkdown,
                  createdAt: message.createdAt,
                },
              },
            ]

        return {
          ...old,
          dmPeers: hasPeer
            ? old.dmPeers
            : [...(old.dmPeers ?? []), { memberId: targetMemberId, streamId: message.streamId }],
          streams: optimisticStream.map((stream) =>
            stream.id === message.streamId && stream.type === StreamTypes.DM
              ? { ...stream, displayName: targetMemberName ?? stream.displayName }
              : stream
          ),
        }
      })

      // Always re-fetch authoritative bootstrap to close any event ordering gaps.
      void queryClient.refetchQueries({ queryKey: workspaceKeys.bootstrap(workspaceId), type: "active" })

      return { navigateTo: `/w/${workspaceId}/s/${message.streamId}`, replace: true }
    },
    [targetMemberId, workspaceId, messageService, queryClient, targetMemberName]
  )

  return {
    stream,
    isLoading: enabled && isLoading,
    isDraft: true,
    error: null,
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
  const streamService = useStreamService()
  const messageService = useMessageService()
  const { markPending, markFailed, markSent } = usePendingMessages()
  const user = useUser()
  const { data: wsBootstrap } = useWorkspaceBootstrap(workspaceId)
  const currentMemberId = wsBootstrap?.members?.find((m) => m.userId === user?.id)?.id ?? null

  const { data: bootstrap, isLoading, error } = useStreamBootstrap(workspaceId, streamId, { enabled })

  const stream: VirtualStream | undefined = bootstrap?.stream
    ? {
        id: bootstrap.stream.id,
        workspaceId: bootstrap.stream.workspaceId,
        type: bootstrap.stream.type,
        slug: bootstrap.stream.slug,
        displayName:
          bootstrap.stream.type === StreamTypes.DM
            ? (() => {
                const workspaceName = wsBootstrap?.streams.find((s) => s.id === bootstrap.stream.id)?.displayName
                if (workspaceName) return workspaceName

                const otherMemberId = bootstrap.members.find((m) => m.memberId !== currentMemberId)?.memberId
                const otherMemberName = wsBootstrap?.members.find((m) => m.id === otherMemberId)?.name ?? null
                return otherMemberName ?? bootstrap.stream.displayName
              })()
            : bootstrap.stream.displayName,
        companionMode: bootstrap.stream.companionMode,
        isDraft: false,
        parentStreamId: bootstrap.stream.parentStreamId,
        parentMessageId: bootstrap.stream.parentMessageId,
        rootStreamId: bootstrap.stream.rootStreamId,
        archivedAt: bootstrap.stream.archivedAt,
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
          streams: wsBootstrap.streams.map((s) => (s.id === streamId ? { ...s, ...updatedStream } : s)),
        }
      })
    },
    [streamId, workspaceId, streamService, queryClient]
  )

  const archive = useCallback(async () => {
    await streamService.archive(workspaceId, streamId)

    // Invalidate to refetch with updated archivedAt
    queryClient.invalidateQueries({ queryKey: streamKeys.bootstrap(workspaceId, streamId) })

    // Remove from workspace sidebar (archived streams don't show there)
    queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
      if (!old || typeof old !== "object") return old
      const wsBootstrap = old as { streams?: Array<{ id: string }> }
      if (!wsBootstrap.streams) return old
      return {
        ...wsBootstrap,
        streams: wsBootstrap.streams.filter((s) => s.id !== streamId),
      }
    })
  }, [streamId, workspaceId, streamService, queryClient])

  const unarchive = useCallback(async () => {
    await streamService.unarchive(workspaceId, streamId)

    // Invalidate to refetch with cleared archivedAt
    queryClient.invalidateQueries({ queryKey: streamKeys.bootstrap(workspaceId, streamId) })

    // Add back to workspace sidebar
    queryClient.invalidateQueries({ queryKey: workspaceKeys.bootstrap(workspaceId) })
  }, [streamId, workspaceId, streamService, queryClient])

  const sendMessage = useCallback(
    async (input: SendMessageInput): Promise<{ navigateTo?: string }> => {
      const clientId = generateClientId()
      const now = new Date().toISOString()

      // Serialize JSON to markdown
      const contentMarkdown = serializeToMarkdown(input.contentJson)

      // Use timestamp as sequence to ensure optimistic events sort after real events
      // Real events have low sequence numbers (1, 2, 3...), timestamps are ~13 digits
      const optimisticSequence = Date.now().toString()

      const optimisticEvent: StreamEvent = {
        id: clientId,
        streamId,
        sequence: optimisticSequence,
        eventType: "message_created",
        payload: {
          messageId: clientId,
          contentMarkdown,
        },
        actorId: currentMemberId,
        actorType: "member",
        createdAt: now,
      }

      // Track as pending in context (for UI status display)
      markPending(clientId)

      // Update React Query cache immediately for instant UI feedback
      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { events: StreamEvent[] }
        return {
          ...bootstrap,
          events: [...bootstrap.events, optimisticEvent],
        }
      })

      // Persist to IndexedDB for recovery/retry capability (store markdown for backwards compatibility)
      await db.pendingMessages.add({
        clientId,
        workspaceId,
        streamId,
        content: contentMarkdown,
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

      try {
        await messageService.create(workspaceId, streamId, {
          streamId,
          contentJson: input.contentJson,
          contentMarkdown,
          attachmentIds: input.attachmentIds,
        })

        // Remove optimistic event immediately to minimize duplication window.
        // The real event will arrive via WebSocket with a different ID.
        queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
          if (!old || typeof old !== "object") return old
          const bootstrap = old as { events: StreamEvent[] }
          return {
            ...bootstrap,
            events: bootstrap.events.filter((e) => e.id !== clientId),
          }
        })
        markSent(clientId)

        // Clean up IndexedDB (fire-and-forget since UI is already updated)
        void db.pendingMessages.delete(clientId)
        void db.events.delete(clientId)
      } catch {
        await db.events.update(clientId, { _status: "failed" })
        markFailed(clientId)
        // Don't throw - failure is shown in timeline with retry option
      }

      return {}
    },
    [streamId, workspaceId, messageService, queryClient, markPending, markFailed, markSent, currentMemberId]
  )

  return {
    stream,
    isLoading,
    isDraft: false,
    error: error ?? null,
    rename,
    archive,
    unarchive,
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
  const isDmDraft = isDmDraftId(streamId)
  const isScratchpadDraft = isDraft && !isDmDraft

  // Call both implementations (React hook rules require consistent hook calls)
  // Each implementation no-ops when not enabled
  const draftResult = useDraftStream(workspaceId, streamId, isScratchpadDraft)
  const draftDmResult = useDraftDmStream(workspaceId, streamId, isDmDraft)
  const realResult = useRealStream(workspaceId, streamId, !isDraft)

  if (isDmDraft) return draftDmResult
  if (isScratchpadDraft) return draftResult
  return realResult
}
