/**
 * Stream Hook with Zustand Store
 *
 * Unidirectional data flow hook for stream/message data.
 *
 * Architecture:
 * - All UI reads from zustand store (single source of truth)
 * - Writes go through outbox (fire-and-forget, shown immediately)
 * - Background workers sync with server
 *
 * Benefits:
 * - Instant message display (no waiting for server)
 * - Offline support (messages queued in outbox)
 * - Auto-retry on failure (with exponential backoff)
 * - Clean, predictable data flow
 */

import { useEffect, useCallback, useMemo, useRef, useState } from "react"
import { useMessageStore, generateTempId, selectStream, selectEvents } from "../stores/message-store"
import { initStreamView, loadMoreEvents as fetchMoreEvents, fetchStream, fetchEvents } from "../workers/stream-fetcher"
import { leaveStream } from "../workers/socket-worker"
import { pokeOutboxWorker } from "../workers/outbox-worker"
import type { Stream, StreamEvent, Mention } from "../types"

// =============================================================================
// Types
// =============================================================================

export interface AgentSessionData {
  id: string
  streamId: string
  triggeringEventId: string
  responseEventId: string | null
  status: "active" | "summarizing" | "completed" | "failed"
  steps: Array<{
    id: string
    type: "gathering_context" | "reasoning" | "tool_call" | "synthesizing"
    content: string
    tool_name?: string
    tool_input?: Record<string, unknown>
    tool_result?: string
    started_at: string
    completed_at?: string
    status: "active" | "completed" | "failed"
  }>
  summary: string | null
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

interface UseStreamWithQueryOptions {
  workspaceId: string
  streamId?: string
  enabled?: boolean
  onStreamUpdate?: (stream: Stream) => void
  // For thinking spaces: persona to use when creating the stream
  selectedPersonaId?: string | null
}

export interface MaterializedStreamResult {
  draftId: string
  realStream: Stream
}

interface UseStreamWithQueryReturn {
  stream: Stream | null
  events: StreamEvent[]
  initialSessions: AgentSessionData[]
  parentStream: Stream | null
  rootEvent: StreamEvent | null
  ancestors: StreamEvent[]
  lastReadEventId: string | null
  isLoading: boolean
  isLoadingMore: boolean
  hasMoreEvents: boolean
  isConnected: boolean
  connectionError: string | null
  isSending: boolean
  currentUserId: string | null
  postMessage: (content: string, mentions?: Mention[]) => Promise<MaterializedStreamResult | void>
  editEvent: (eventId: string, newContent: string) => Promise<void>
  shareEvent: (eventId: string, context?: string) => Promise<void>
  createThread: (eventId: string) => Promise<Stream>
  loadMoreEvents: () => Promise<void>
  updateLinkedStreams: (eventId: string, stream: { id: string; name: string; slug: string }) => void
  setLastReadEventId: (eventId: string | null) => void
  retryMessage: (tempId: string) => Promise<void>
}

// =============================================================================
// Helpers
// =============================================================================

const isPendingThread = (id: string | undefined): boolean => id?.startsWith("event_") === true
const isDraftThinkingSpace = (id: string | undefined): boolean => id?.startsWith("draft_thinking_space_") === true

// Extract personaId from draft thinking space ID (format: draft_thinking_space_{timestamp}_{personaId})
const extractPersonaIdFromDraft = (draftId: string): string | null => {
  const parts = draftId.split("_")
  // draft_thinking_space_{timestamp}_{personaId} = 5 parts minimum
  if (parts.length >= 5) {
    return parts.slice(4).join("_") // Handle personaIds that might contain underscores
  }
  return null
}

// =============================================================================
// Hook
// =============================================================================

export function useStreamWithQuery({
  workspaceId,
  streamId,
  enabled = true,
  onStreamUpdate,
  selectedPersonaId,
}: UseStreamWithQueryOptions): UseStreamWithQueryReturn {
  // Subscribe to store slices
  const streamCache = useMessageStore(streamId ? selectStream(streamId) : () => undefined)
  const eventsCache = useMessageStore(streamId ? selectEvents(streamId) : () => undefined)
  const outbox = useMessageStore((s) => s.outbox)
  const isWebSocketConnected = useMessageStore((s) => s.isWebSocketConnected)

  // Local state
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [initialSessions, setInitialSessions] = useState<AgentSessionData[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)

  // Refs
  const onStreamUpdateRef = useRef(onStreamUpdate)
  onStreamUpdateRef.current = onStreamUpdate

  // Fetch current user on mount
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data.id) setCurrentUserId(data.id)
        if (data.email) setCurrentUserEmail(data.email)
      })
      .catch(() => {})
  }, [])

  // Initialize stream view when streamId changes
  useEffect(() => {
    if (!enabled || !streamId || !workspaceId) return

    setConnectionError(null)
    setInitialSessions([])

    // Handle draft thinking spaces (not created yet)
    if (isDraftThinkingSpace(streamId)) {
      // Create a virtual stream in the store
      const store = useMessageStore.getState()
      store.setStream(streamId, {
        stream: {
          id: streamId,
          workspaceId,
          streamType: "thinking_space",
          name: null,
          slug: streamId,
          description: null,
          topic: null,
          parentStreamId: null,
          branchedFromEventId: null,
          visibility: "private",
          status: "active",
          isMember: true,
          unreadCount: 0,
          lastReadAt: new Date().toISOString(),
          notifyLevel: "all",
          pinnedAt: null,
        },
        lastFetchedAt: Date.now(),
        ancestors: [],
      })
      store.setEvents(streamId, {
        events: [],
        hasMore: false,
        lastFetchedAt: Date.now(),
      })
      return
    }

    // Handle pending threads
    if (isPendingThread(streamId)) {
      handlePendingThread(workspaceId, streamId)
      return
    }

    // Normal stream - init view (joins socket, fetches data)
    initStreamView(workspaceId, streamId)

    // Fetch sessions for AI thinking events
    fetchSessionsForStream(workspaceId, streamId)

    return () => {
      leaveStream(streamId)
    }
  }, [enabled, streamId, workspaceId])

  // Helper to handle pending threads
  const handlePendingThread = async (wsId: string, eventId: string) => {
    const store = useMessageStore.getState()

    try {
      // Check if thread was created since we opened
      const threadRes = await fetch(`/api/workspace/${wsId}/streams/by-event/${eventId}/thread`, {
        credentials: "include",
      })

      if (threadRes.ok) {
        const threadData = await threadRes.json()
        if (threadData.thread) {
          const realThreadId = threadData.thread.id

          // Register alias so WebSocket events for realThreadId also update eventId cache
          store.addStreamAlias(realThreadId, eventId)

          // Init the real stream view (joins socket room, fetches data for realThreadId)
          initStreamView(wsId, realThreadId)

          // Also store under event ID so our subscription gets the data
          // (component is subscribed to eventId, not realThreadId)
          store.setStream(eventId, {
            stream: threadData.thread,
            parentStream: threadData.parentStream,
            rootEvent: threadData.rootEvent,
            ancestors: threadData.ancestors || [],
            lastFetchedAt: Date.now(),
          })

          // Fetch events for the real thread and store under event ID
          const eventsRes = await fetch(
            `/api/workspace/${wsId}/streams/${realThreadId}/events?limit=50`,
            { credentials: "include" },
          )
          if (eventsRes.ok) {
            const eventsData = await eventsRes.json()
            store.setEvents(eventId, {
              events: eventsData.events || [],
              hasMore: eventsData.hasMore || false,
              lastFetchedAt: Date.now(),
              lastReadEventId: eventsData.lastReadEventId,
            })
          }
          return
        }
      }

      // No thread yet - fetch the event info to show in the UI
      const eventRes = await fetch(`/api/workspace/${wsId}/events/${eventId}`, { credentials: "include" })

      if (eventRes.ok) {
        const eventInfo = await eventRes.json()

        // Create virtual pending stream
        store.setStream(eventId, {
          stream: {
            id: `pending_${eventId}`,
            workspaceId: wsId,
            streamType: "thread",
            name: null,
            slug: null,
            description: null,
            topic: null,
            parentStreamId: eventInfo.stream?.id || null,
            branchedFromEventId: eventId,
            visibility: "inherit",
            status: "active",
            isMember: true,
            unreadCount: 0,
            lastReadAt: null,
            notifyLevel: "default",
            pinnedAt: null,
          },
          parentStream: eventInfo.stream,
          rootEvent: eventInfo.event,
          ancestors: [],
          lastFetchedAt: Date.now(),
        })

        store.setEvents(eventId, {
          events: [],
          hasMore: false,
          lastFetchedAt: Date.now(),
        })
      }
    } catch (error) {
      console.error("[useStreamWithQuery] Failed to load pending thread:", error)
      setConnectionError("Failed to load thread")
    }
  }

  // Helper to fetch sessions
  const fetchSessionsForStream = async (wsId: string, sId: string) => {
    try {
      const res = await fetch(`/api/workspace/${wsId}/streams/${sId}/events?limit=50`, {
        credentials: "include",
      })
      if (res.ok) {
        const data = await res.json()
        if (data.sessions) {
          setInitialSessions(data.sessions)
        }
      }
    } catch {
      // Ignore - sessions are optional
    }
  }

  // Call onStreamUpdate when stream changes
  useEffect(() => {
    if (streamCache?.stream && onStreamUpdateRef.current) {
      onStreamUpdateRef.current(streamCache.stream)
    }
  }, [streamCache?.stream])

  // Merge events with outbox messages
  const events = useMemo(() => {
    if (!streamId) return []

    const serverEvents = eventsCache?.events || []

    // Get outbox messages for this stream
    const outboxMessages = outbox.filter((m) => m.workspaceId === workspaceId && m.streamId === streamId)

    // Convert outbox to StreamEvent format
    const outboxEvents: StreamEvent[] = outboxMessages.map((msg) => ({
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
    }))

    // Merge: server events (excluding those in outbox by ID) + outbox events
    const outboxIds = new Set(outboxMessages.map((m) => m.id))
    const filteredServerEvents = serverEvents.filter((e) => !outboxIds.has(e.id))

    // Sort by createdAt
    return [...filteredServerEvents, ...outboxEvents].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
  }, [eventsCache?.events, outbox, workspaceId, streamId])

  // ==========================================================================
  // Actions
  // ==========================================================================

  const postMessage = useCallback(
    async (content: string, mentions?: Mention[]): Promise<MaterializedStreamResult | void> => {
      if (!streamId || !workspaceId || !content.trim()) return

      // Handle draft thinking space materialization
      if (isDraftThinkingSpace(streamId)) {
        const draftId = streamId
        // Use selectedPersonaId from props, fall back to extracting from draft ID
        const personaId = selectedPersonaId || extractPersonaIdFromDraft(draftId)

        // Create the real thinking space first
        const createRes = await fetch(`/api/workspace/${workspaceId}/thinking-spaces`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(personaId ? { personaId } : {}),
        })

        if (!createRes.ok) {
          const error = await createRes.json()
          throw new Error(error.error || "Failed to create thinking space")
        }

        const realStream: Stream = await createRes.json()

        // Update store with real stream
        const store = useMessageStore.getState()
        store.setStream(realStream.id, {
          stream: realStream,
          lastFetchedAt: Date.now(),
          ancestors: [],
        })

        // Now add message to outbox for the real stream
        const tempId = generateTempId()
        store.addToOutbox({
          id: tempId,
          workspaceId,
          streamId: realStream.id,
          content: content.trim(),
          mentions,
          actorId: currentUserId || "",
          actorEmail: currentUserEmail || "",
          createdAt: new Date().toISOString(),
        })

        pokeOutboxWorker()

        return { draftId, realStream }
      }

      // Normal message posting - add to outbox
      const tempId = generateTempId()
      const store = useMessageStore.getState()

      store.addToOutbox({
        id: tempId,
        workspaceId,
        streamId,
        content: content.trim(),
        mentions,
        actorId: currentUserId || "",
        actorEmail: currentUserEmail || "",
        createdAt: new Date().toISOString(),
        parentEventId: isPendingThread(streamId) ? streamId : undefined,
        parentStreamId: streamCache?.parentStream?.id,
      })

      pokeOutboxWorker()
    },
    [workspaceId, streamId, currentUserId, currentUserEmail, streamCache?.parentStream?.id, selectedPersonaId],
  )

  const loadMoreEvents = useCallback(async () => {
    if (!streamId || !workspaceId || isLoadingMore) return

    setIsLoadingMore(true)
    try {
      await fetchMoreEvents(workspaceId, streamId)
    } finally {
      setIsLoadingMore(false)
    }
  }, [workspaceId, streamId, isLoadingMore])

  const editEvent = useCallback(
    async (eventId: string, newContent: string) => {
      if (!streamId || !newContent.trim()) return

      const res = await fetch(`/api/workspace/${workspaceId}/streams/${streamId}/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: newContent.trim() }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || "Failed to edit event")
      }
    },
    [workspaceId, streamId],
  )

  const shareEvent = useCallback(
    async (eventId: string, context?: string) => {
      if (!streamId) return

      const res = await fetch(`/api/workspace/${workspaceId}/streams/${streamId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventId, context }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || "Failed to share event")
      }
    },
    [workspaceId, streamId],
  )

  const createThread = useCallback(
    async (eventId: string): Promise<Stream> => {
      if (!streamId) throw new Error("No stream selected")

      const res = await fetch(`/api/workspace/${workspaceId}/streams/${streamId}/thread`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventId }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || "Failed to create thread")
      }

      return (await res.json()).stream
    },
    [workspaceId, streamId],
  )

  const retryMessage = useCallback(async (tempId: string) => {
    const store = useMessageStore.getState()
    store.updateOutboxStatus(tempId, "pending")
    pokeOutboxWorker()
  }, [])

  // Determine loading state
  const isLoading = enabled && !!streamId && !streamCache && !isDraftThinkingSpace(streamId)

  return {
    stream: streamCache?.stream ?? null,
    events,
    initialSessions,
    parentStream: streamCache?.parentStream ?? null,
    rootEvent: streamCache?.rootEvent ?? null,
    ancestors: streamCache?.ancestors ?? [],
    lastReadEventId: eventsCache?.lastReadEventId ?? null,
    isLoading,
    isLoadingMore,
    hasMoreEvents: eventsCache?.hasMore ?? false,
    isConnected: isWebSocketConnected,
    connectionError,
    isSending: outbox.some((m) => m.streamId === streamId && m.status === "sending"),
    currentUserId,
    postMessage,
    editEvent,
    shareEvent,
    createThread,
    loadMoreEvents,
    updateLinkedStreams: () => {},
    setLastReadEventId: () => {},
    retryMessage,
  }
}
