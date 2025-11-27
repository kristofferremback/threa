import { useState, useEffect, useRef, useCallback } from "react"
import { io, Socket } from "socket.io-client"
import { toast } from "sonner"
import type { Stream, StreamEvent, Mention, ThreadData } from "../types"

// Room name builders (must match server)
const room = {
  stream: (workspaceId: string, streamId: string) => `ws:${workspaceId}:stream:${streamId}`,
}

// ==========================================================================
// Types
// ==========================================================================

interface UseStreamOptions {
  workspaceId: string
  streamId?: string
  enabled?: boolean
}

interface UseStreamReturn {
  stream: Stream | null
  events: StreamEvent[]
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
  postMessage: (content: string, mentions?: Mention[]) => Promise<void>
  editEvent: (eventId: string, newContent: string) => Promise<void>
  shareEvent: (eventId: string, context?: string) => Promise<void>
  createThread: (eventId: string) => Promise<Stream>
  loadMoreEvents: () => Promise<void>
  updateLinkedStreams: (eventId: string, stream: { id: string; name: string; slug: string }) => void
  setLastReadEventId: (eventId: string | null) => void
}

const EVENT_PAGE_SIZE = 50

// ==========================================================================
// Hook
// ==========================================================================

export function useStream({
  workspaceId,
  streamId,
  enabled = true,
}: UseStreamOptions): UseStreamReturn {
  // State
  const [stream, setStream] = useState<Stream | null>(null)
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [parentStream, setParentStream] = useState<Stream | null>(null)
  const [rootEvent, setRootEvent] = useState<StreamEvent | null>(null)
  const [ancestors, setAncestors] = useState<StreamEvent[]>([])
  const [lastReadEventId, setLastReadEventId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMoreEvents, setHasMoreEvents] = useState(true)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Refs
  const socketRef = useRef<Socket | null>(null)
  const currentStreamRef = useRef<string | undefined>(streamId)

  // Keep ref in sync
  useEffect(() => {
    currentStreamRef.current = streamId
  }, [streamId])

  // ==========================================================================
  // Socket Connection & Event Handling
  // ==========================================================================

  useEffect(() => {
    if (!enabled || !streamId) {
      setIsLoading(false)
      return
    }

    const socket = io({ withCredentials: true })
    socketRef.current = socket

    // Reset state for new stream
    setEvents([])
    setStream(null)
    setParentStream(null)
    setRootEvent(null)
    setAncestors([])
    setLastReadEventId(null)
    setIsLoading(true)
    setHasMoreEvents(true)

    socket.on("connect", () => {
      setIsConnected(true)
      setConnectionError(null)
    })

    socket.on("disconnect", () => {
      setIsConnected(false)
    })

    socket.on("connect_error", (error) => {
      setConnectionError(error.message)
      setIsConnected(false)
    })

    // Handle new events
    socket.on("event", (data: StreamEvent) => {
      if (data.streamId !== currentStreamRef.current) return

      setEvents((prev) => {
        if (prev.some((e) => e.id === data.id)) return prev
        return [...prev, data]
      })
    })

    // Handle event edits
    socket.on("event:edited", (data: { id: string; content: string; editedAt: string }) => {
      setEvents((prev) =>
        prev.map((e) =>
          e.id === data.id ? { ...e, content: data.content, editedAt: data.editedAt, isEdited: true } : e,
        ),
      )
    })

    // Handle event deletes
    socket.on("event:deleted", (data: { id: string }) => {
      setEvents((prev) => prev.filter((e) => e.id !== data.id))
    })

    // Handle read cursor updates from other devices
    socket.on("readCursor:updated", (data: { streamId: string; eventId: string }) => {
      if (data.streamId === currentStreamRef.current) {
        setLastReadEventId(data.eventId)
      }
    })

    // Join stream room and fetch data
    const subscribeAndFetch = async () => {
      socket.emit("join", room.stream(workspaceId, streamId))
      await fetchStreamData()
    }

    if (socket.connected) {
      subscribeAndFetch()
    } else {
      socket.once("connect", subscribeAndFetch)
    }

    return () => {
      if (streamId) {
        socket.emit("leave", room.stream(workspaceId, streamId))
      }
      socket.disconnect()
      socketRef.current = null
    }
  }, [enabled, workspaceId, streamId])

  // ==========================================================================
  // Data Fetching
  // ==========================================================================

  const fetchStreamData = async () => {
    if (!streamId) return

    try {
      setIsLoading(true)

      // Fetch stream info
      const streamRes = await fetch(`/api/workspace/${workspaceId}/streams/${streamId}`, {
        credentials: "include",
      })

      if (!streamRes.ok) {
        throw new Error("Failed to fetch stream")
      }

      const streamData = await streamRes.json()
      setStream(streamData)

      // If this is a thread, fetch parent info
      if (streamData.parentStreamId) {
        const parentRes = await fetch(`/api/workspace/${workspaceId}/streams/${streamData.parentStreamId}`, {
          credentials: "include",
        })
        if (parentRes.ok) {
          setParentStream(await parentRes.json())
        }

        // Fetch root event if branched from one
        if (streamData.branchedFromEventId) {
          // TODO: Fetch root event
        }
      }

      // Fetch events
      const eventsRes = await fetch(
        `/api/workspace/${workspaceId}/streams/${streamId}/events?limit=${EVENT_PAGE_SIZE}`,
        { credentials: "include" },
      )

      if (!eventsRes.ok) {
        throw new Error("Failed to fetch events")
      }

      const eventsData = await eventsRes.json()
      setEvents(eventsData.events || [])
      setLastReadEventId(eventsData.lastReadEventId || null)
      setHasMoreEvents(eventsData.hasMore || false)

      // Get current user from bootstrap or auth
      const authRes = await fetch("/api/auth/me", { credentials: "include" })
      if (authRes.ok) {
        const authData = await authRes.json()
        setCurrentUserId(authData.user?.id || null)
      }
    } catch (error) {
      console.error("Failed to fetch stream data:", error)
      setConnectionError(error instanceof Error ? error.message : "Failed to load stream")
    } finally {
      setIsLoading(false)
    }
  }

  const loadMoreEvents = useCallback(async () => {
    if (!streamId || isLoadingMore || !hasMoreEvents) return

    setIsLoadingMore(true)
    try {
      const offset = events.length
      const res = await fetch(
        `/api/workspace/${workspaceId}/streams/${streamId}/events?limit=${EVENT_PAGE_SIZE}&offset=${offset}`,
        { credentials: "include" },
      )

      if (!res.ok) throw new Error("Failed to load more events")

      const data = await res.json()
      const olderEvents = data.events || []

      setHasMoreEvents(olderEvents.length >= EVENT_PAGE_SIZE)

      // Prepend older events
      setEvents((prev) => {
        const allEvents = [...olderEvents, ...prev]
        const unique = allEvents.filter((e, idx, arr) => arr.findIndex((x) => x.id === e.id) === idx)
        return unique.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      })
    } catch (error) {
      console.error("Failed to load more events:", error)
      toast.error("Failed to load older events")
    } finally {
      setIsLoadingMore(false)
    }
  }, [workspaceId, streamId, events.length, isLoadingMore, hasMoreEvents])

  // ==========================================================================
  // Actions
  // ==========================================================================

  const postMessage = useCallback(
    async (content: string, mentions?: Mention[]) => {
      if (!streamId || !content.trim() || isSending) return

      setIsSending(true)
      try {
        const res = await fetch(`/api/workspace/${workspaceId}/streams/${streamId}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ content: content.trim(), mentions }),
        })

        if (!res.ok) {
          const error = await res.json()
          throw new Error(error.error || "Failed to post message")
        }

        // Event will come through websocket
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to send message")
        throw error
      } finally {
        setIsSending(false)
      }
    },
    [workspaceId, streamId, isSending],
  )

  const editEvent = useCallback(
    async (eventId: string, newContent: string) => {
      if (!streamId || !newContent.trim()) return

      try {
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

        // Update will come through websocket
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to edit message")
        throw error
      }
    },
    [workspaceId, streamId],
  )

  const shareEvent = useCallback(
    async (eventId: string, context?: string) => {
      if (!streamId) return

      try {
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

        toast.success("Shared to stream")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to share")
        throw error
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

      const data = await res.json()
      return data.stream
    },
    [workspaceId, streamId],
  )

  const updateLinkedStreams = useCallback(
    (eventId: string, linkedStream: { id: string; name: string; slug: string }) => {
      // This is for cross-posting UI updates - may not be needed in new model
      // since shares are separate events
    },
    [],
  )

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    stream,
    events,
    parentStream,
    rootEvent,
    ancestors,
    lastReadEventId,
    isLoading,
    isLoadingMore,
    hasMoreEvents,
    isConnected,
    connectionError,
    isSending,
    currentUserId,
    postMessage,
    editEvent,
    shareEvent,
    createThread,
    loadMoreEvents,
    updateLinkedStreams,
    setLastReadEventId,
  }
}

