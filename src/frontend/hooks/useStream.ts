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

export interface MaterializedStreamResult {
  draftId: string
  realStream: Stream
}

interface UseStreamReturn {
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
}

const EVENT_PAGE_SIZE = 50

// Helper to detect if an ID is an event ID (pending thread) vs stream ID
const isPendingThread = (id: string | undefined): boolean => {
  return id?.startsWith("event_") === true
}

// Helper to detect if an ID is a draft thinking space
const isDraftThinkingSpace = (id: string | undefined): boolean => {
  return id?.startsWith("draft_thinking_space_") === true
}

// ==========================================================================
// Hook
// ==========================================================================

// Agent session type for initial load from events endpoint
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

export function useStream({ workspaceId, streamId, enabled = true }: UseStreamOptions): UseStreamReturn {
  // State
  const [stream, setStream] = useState<Stream | null>(null)
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [initialSessions, setInitialSessions] = useState<AgentSessionData[]>([])
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

  // For pending threads: the event ID we're replying to
  const [pendingEventId, setPendingEventId] = useState<string | null>(null)
  // For pending threads: the parent stream ID to use in reply endpoint
  const [parentStreamIdForReply, setParentStreamIdForReply] = useState<string | null>(null)

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
    setInitialSessions([])
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

    // Handle reply count updates (when someone replies to a message in this stream)
    socket.on("replyCount:updated", (data: { eventId: string; replyCount: number }) => {
      setEvents((prev) =>
        prev.map((e) => (e.id === data.eventId ? { ...e, replyCount: data.replyCount } : e)),
      )
    })

    // Handle thread creation (when viewing a pending thread and it gets created)
    socket.on("thread:created", async (data: { threadId: string; parentStreamId: string; branchedFromEventId: string }) => {
      // Check if we're viewing this pending thread
      const currentId = currentStreamRef.current
      if (!currentId) return

      // If we're viewing this event as a pending thread, switch to the real thread
      if (isPendingThread(currentId) && currentId === data.branchedFromEventId) {
        // Fetch the real thread data
        try {
          const res = await fetch(`/api/workspace/${workspaceId}/streams/${data.threadId}`, {
            credentials: "include",
          })
          if (res.ok) {
            const threadData = await res.json()
            setStream(threadData)
            setPendingEventId(null)
            currentStreamRef.current = data.threadId
            // Join the new thread's room
            socket.emit("join", room.stream(workspaceId, data.threadId))
            // Fetch events
            const eventsRes = await fetch(
              `/api/workspace/${workspaceId}/streams/${data.threadId}/events?limit=50`,
              { credentials: "include" },
            )
            if (eventsRes.ok) {
              const eventsData = await eventsRes.json()
              setEvents(eventsData.events || [])
              setInitialSessions(eventsData.sessions || [])
            }
          }
        } catch (err) {
          console.error("Failed to fetch thread after creation:", err)
        }
      }
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

      // Check if this is a draft thinking space (not yet created on server)
      if (isDraftThinkingSpace(streamId)) {
        // Create a virtual stream for the UI - will be materialized on first message
        setStream({
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
        })
        setEvents([])
        setHasMoreEvents(false)

        // Get current user
        const authRes = await fetch("/api/auth/me", { credentials: "include" })
        if (authRes.ok) {
          const authData = await authRes.json()
          setCurrentUserId(authData.user?.id || null)
        }
        setIsLoading(false)
        return
      }

      // Check if this is a pending thread (streamId is actually an eventId)
      if (isPendingThread(streamId)) {
        // This is a pending thread - we're opening a thread view for an event that doesn't have a thread yet
        const eventId = streamId

        // First, check if a thread was created since we opened
        const threadRes = await fetch(`/api/workspace/${workspaceId}/streams/by-event/${eventId}/thread`, {
          credentials: "include",
        })

        if (threadRes.ok) {
          const threadData = await threadRes.json()
          if (threadData.thread) {
            // Thread exists now! Use it instead
            setStream(threadData.thread)
            setPendingEventId(null)
            setParentStreamIdForReply(null)
            // Update the ref so websocket events are received
            currentStreamRef.current = threadData.thread.id
            // Join the real thread's room
            if (socketRef.current) {
              socketRef.current.emit("join", room.stream(workspaceId, threadData.thread.id))
            }
            // Continue to fetch events for this stream
            const eventsRes = await fetch(
              `/api/workspace/${workspaceId}/streams/${threadData.thread.id}/events?limit=${EVENT_PAGE_SIZE}`,
              { credentials: "include" },
            )
            if (eventsRes.ok) {
              const eventsData = await eventsRes.json()
              setEvents(eventsData.events || [])
              setInitialSessions(eventsData.sessions || [])
              setLastReadEventId(eventsData.lastReadEventId || null)
              setHasMoreEvents(eventsData.hasMore || false)
            }
            // Fetch parent stream and ancestors
            if (threadData.thread.parentStreamId) {
              const parentRes = await fetch(
                `/api/workspace/${workspaceId}/streams/${threadData.thread.parentStreamId}`,
                { credentials: "include" },
              )
              if (parentRes.ok) {
                const parentData = await parentRes.json()
                setParentStream(parentData)
                setParentStreamIdForReply(parentData.id)
              }

              // Fetch ancestor chain
              const ancestorsRes = await fetch(
                `/api/workspace/${workspaceId}/streams/${threadData.thread.id}/ancestors`,
                { credentials: "include" },
              )
              if (ancestorsRes.ok) {
                const ancestorsData = await ancestorsRes.json()
                setAncestors(ancestorsData.ancestors || [])
              }
            }
            // Fetch root event
            if (threadData.rootEvent) {
              setRootEvent(threadData.rootEvent)
            }
            setIsLoading(false)
            return
          }
        }

        // No thread exists yet - this is a pending thread
        setPendingEventId(eventId)
        setEvents([]) // No replies yet
        setHasMoreEvents(false)

        // We need to fetch the original event and its parent stream
        // The event fetch endpoint should return both
        const eventInfoRes = await fetch(`/api/workspace/${workspaceId}/events/${eventId}`, { credentials: "include" })

        if (eventInfoRes.ok) {
          const eventInfo = await eventInfoRes.json()
          setRootEvent(eventInfo.event)
          setParentStream(eventInfo.stream)
          setParentStreamIdForReply(eventInfo.stream?.id || null)

          // For pending threads, we need to build the ancestor chain manually
          // The root event IS the first ancestor, and we need to fetch any ancestors of the parent stream
          if (eventInfo.stream?.id) {
            // If the parent stream is also a thread, fetch its ancestors
            if (eventInfo.stream.streamType === "thread" && eventInfo.stream.parentStreamId) {
              const ancestorsRes = await fetch(
                `/api/workspace/${workspaceId}/streams/${eventInfo.stream.id}/ancestors`,
                { credentials: "include" },
              )
              if (ancestorsRes.ok) {
                const ancestorsData = await ancestorsRes.json()
                // The root event (eventInfo.event) will be shown separately,
                // so ancestors are the parent stream's ancestors
                setAncestors(ancestorsData.ancestors || [])
              }
            }
          }

          // Create a "virtual" thread stream for the UI
          setStream({
            id: `pending_${eventId}`,
            workspaceId,
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
          })
        } else {
          throw new Error("Failed to fetch event info")
        }

        // Get current user
        const authRes = await fetch("/api/auth/me", { credentials: "include" })
        if (authRes.ok) {
          const authData = await authRes.json()
          setCurrentUserId(authData.user?.id || null)
        }
        setIsLoading(false)
        return
      }

      // Normal stream fetch
      const streamRes = await fetch(`/api/workspace/${workspaceId}/streams/${streamId}`, {
        credentials: "include",
      })

      if (!streamRes.ok) {
        throw new Error("Failed to fetch stream")
      }

      const streamData = await streamRes.json()
      setStream(streamData)
      setPendingEventId(null)

      // If this is a thread, fetch parent info and ancestors
      if (streamData.parentStreamId) {
        const parentRes = await fetch(`/api/workspace/${workspaceId}/streams/${streamData.parentStreamId}`, {
          credentials: "include",
        })
        if (parentRes.ok) {
          const parentData = await parentRes.json()
          setParentStream(parentData)
          setParentStreamIdForReply(parentData.id)
        }

        // Fetch root event if branched from one
        if (streamData.branchedFromEventId) {
          const rootEventRes = await fetch(`/api/workspace/${workspaceId}/events/${streamData.branchedFromEventId}`, {
            credentials: "include",
          })
          if (rootEventRes.ok) {
            const rootEventData = await rootEventRes.json()
            setRootEvent(rootEventData.event)
          }
        }

        // Fetch ancestor chain for nested threads
        const ancestorsRes = await fetch(`/api/workspace/${workspaceId}/streams/${streamId}/ancestors`, {
          credentials: "include",
        })
        if (ancestorsRes.ok) {
          const ancestorsData = await ancestorsRes.json()
          setAncestors(ancestorsData.ancestors || [])
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
      setInitialSessions(eventsData.sessions || [])
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
    async (content: string, mentions?: Mention[]): Promise<MaterializedStreamResult | void> => {
      if (!streamId || !content.trim() || isSending) return

      setIsSending(true)
      try {
        // Check if this is a draft thinking space that needs to be materialized
        if (isDraftThinkingSpace(streamId)) {
          const draftId = streamId

          // First, create the real thinking space
          const createRes = await fetch(`/api/workspace/${workspaceId}/thinking-spaces`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({}), // Name will be auto-generated from first message
          })

          if (!createRes.ok) {
            const error = await createRes.json()
            throw new Error(error.error || "Failed to create thinking space")
          }

          const realStream: Stream = await createRes.json()

          // Update local state to use the real stream
          setStream(realStream)
          currentStreamRef.current = realStream.id

          // Join the new stream's websocket room
          if (socketRef.current) {
            socketRef.current.emit("join", room.stream(workspaceId, realStream.id))
          }

          // Now post the message to the real stream
          const postRes = await fetch(`/api/workspace/${workspaceId}/streams/${realStream.id}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ content: content.trim(), mentions }),
          })

          if (!postRes.ok) {
            const error = await postRes.json()
            throw new Error(error.error || "Failed to post message")
          }

          // Return info about the materialized stream so caller can update parent state
          return { draftId, realStream }
        }

        // Check if this is a pending thread by:
        // 1. pendingEventId state is set, OR
        // 2. streamId starts with "event_" (fallback check)
        const isPostingToPendingThread = pendingEventId || isPendingThread(streamId)
        const eventIdToReplyTo = pendingEventId || (isPendingThread(streamId) ? streamId : null)
        const parentId = parentStreamIdForReply || parentStream?.id

        if (isPostingToPendingThread && eventIdToReplyTo) {
          if (!parentId) {
            throw new Error("Cannot post to thread: parent stream not found. Please refresh and try again.")
          }
          const res = await fetch(
            `/api/workspace/${workspaceId}/streams/${parentId}/events/${eventIdToReplyTo}/reply`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ content: content.trim(), mentions }),
            },
          )

          if (!res.ok) {
            const error = await res.json()
            throw new Error(error.error || "Failed to post reply")
          }

          const data = await res.json()

          // Thread was created! Update our state to use the real stream
          if (data.threadCreated && data.stream) {
            setStream(data.stream)
            setPendingEventId(null)
            // Update the currentStreamRef so websocket events work
            currentStreamRef.current = data.stream.id
            // Join the new stream's room
            if (socketRef.current) {
              socketRef.current.emit("join", room.stream(workspaceId, data.stream.id))
            }
          }

          // Add the event to our list
          if (data.event) {
            setEvents((prev) => [...prev, data.event])
          }

          return
        }

        // Normal post to existing stream
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
    [workspaceId, streamId, isSending, pendingEventId, parentStreamIdForReply, parentStream],
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
    initialSessions,
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
