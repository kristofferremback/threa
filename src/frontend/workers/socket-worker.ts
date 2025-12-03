/**
 * Socket Worker
 *
 * Manages WebSocket connections and writes incoming events to the message store.
 * Responsibilities:
 * - Maintain Socket.IO connection
 * - Join/leave stream rooms as needed
 * - Handle incoming events and update the store
 * - Trigger background refresh on reconnect
 *
 * Events from the server go directly into the zustand store,
 * which then triggers UI updates via React subscriptions.
 */

import { io, Socket } from "socket.io-client"
import { useMessageStore } from "../stores/message-store"
import type { Stream, StreamEvent } from "../types"

// =============================================================================
// Types
// =============================================================================

interface SocketEventData {
  id: string
  streamId: string
  eventType: string
  actorId?: string
  actorEmail: string
  actorName?: string
  agentId?: string
  agentName?: string
  content?: string
  mentions?: Array<{ type: string; id: string; label: string }>
  payload?: Record<string, unknown>
  createdAt: string
  clientMessageId?: string
  isCrosspost?: boolean
  originalStreamId?: string
}

interface EventEditedData {
  id: string
  content: string
  editedAt: string
}

interface EventDeletedData {
  id: string
}

interface StreamUpdatedData {
  id: string
  name?: string
  slug?: string
  description?: string
  topic?: string
}

interface ReplyCountData {
  eventId: string
  replyCount: number
}

interface ThreadCreatedData {
  threadId: string
  parentStreamId: string
  branchedFromEventId: string
  name: string | null
  slug: string | null
}

// =============================================================================
// Room Name Builders (must match server)
// =============================================================================

const room = {
  stream: (workspaceId: string, streamId: string) => `ws:${workspaceId}:stream:${streamId}`,
  workspace: (workspaceId: string) => `ws:${workspaceId}:workspace`,
}

// =============================================================================
// Socket State
// =============================================================================

let socket: Socket | null = null
let currentWorkspaceId: string | null = null
let joinedStreams = new Set<string>()
let reconnectCallbacks: Array<() => void> = []

// =============================================================================
// Socket Connection
// =============================================================================

/**
 * Initialize the socket connection for a workspace.
 * Should be called once when entering a workspace.
 */
export function initSocket(workspaceId: string) {
  if (socket && currentWorkspaceId === workspaceId) {
    return // Already connected to this workspace
  }

  // Disconnect existing socket if switching workspaces
  if (socket) {
    disconnectSocket()
  }

  currentWorkspaceId = workspaceId
  socket = io({ withCredentials: true })

  const store = useMessageStore.getState()

  socket.on("connect", () => {
    console.log("[SocketWorker] Connected")
    store.setWebSocketConnected(true)

    // Rejoin all previously joined streams
    for (const streamId of joinedStreams) {
      socket?.emit("join", room.stream(workspaceId, streamId))
    }

    // Join workspace room for notifications
    socket?.emit("join", room.workspace(workspaceId))

    // Trigger reconnect callbacks (for background refresh)
    for (const callback of reconnectCallbacks) {
      callback()
    }
  })

  socket.on("disconnect", () => {
    console.log("[SocketWorker] Disconnected")
    store.setWebSocketConnected(false)
  })

  socket.on("connect_error", (err) => {
    console.warn("[SocketWorker] Connection error:", err.message)
    store.setWebSocketConnected(false)
  })

  // Handle new events
  socket.on("event", (data: SocketEventData) => {
    handleNewEvent(data)
  })

  // Handle event edits
  socket.on("event:edited", (data: EventEditedData) => {
    handleEventEdited(data)
  })

  // Handle event deletes
  socket.on("event:deleted", (data: EventDeletedData) => {
    handleEventDeleted(data)
  })

  // Handle stream updates
  socket.on("stream:updated", (data: StreamUpdatedData) => {
    handleStreamUpdated(data)
  })

  // Handle reply count updates
  socket.on("replyCount:updated", (data: ReplyCountData) => {
    handleReplyCountUpdated(data)
  })

  // Handle thread creation (for pending thread -> real thread conversion)
  socket.on("thread:created", (data: ThreadCreatedData) => {
    handleThreadCreated(data)
  })
}

/**
 * Disconnect the socket.
 * Should be called when leaving a workspace.
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
  currentWorkspaceId = null
  joinedStreams.clear()
  useMessageStore.getState().setWebSocketConnected(false)
}

// =============================================================================
// Room Management
// =============================================================================

/**
 * Join a stream room to receive events for that stream.
 * If socket isn't connected yet, queues the room to join on connect.
 */
export function joinStream(streamId: string) {
  if (joinedStreams.has(streamId)) {
    return // Already joined or queued
  }

  // Always add to set - will be joined on connect if socket not ready
  joinedStreams.add(streamId)

  if (!socket || !currentWorkspaceId) {
    console.log(`[SocketWorker] Queued stream ${streamId} to join on connect`)
    return
  }

  socket.emit("join", room.stream(currentWorkspaceId, streamId))
  console.log(`[SocketWorker] Joined stream ${streamId}`)
}

/**
 * Leave a stream room.
 */
export function leaveStream(streamId: string) {
  if (!socket || !currentWorkspaceId) {
    return
  }

  if (!joinedStreams.has(streamId)) {
    return // Not joined
  }

  joinedStreams.delete(streamId)
  socket.emit("leave", room.stream(currentWorkspaceId, streamId))
  console.log(`[SocketWorker] Left stream ${streamId}`)
}

/**
 * Register a callback to be called on reconnect.
 * Useful for triggering background refresh.
 */
export function onReconnect(callback: () => void) {
  reconnectCallbacks.push(callback)
  return () => {
    reconnectCallbacks = reconnectCallbacks.filter((cb) => cb !== callback)
  }
}

/**
 * Check if socket is connected
 */
export function isSocketConnected(): boolean {
  return socket?.connected ?? false
}

/**
 * Get the current socket instance (for advanced use cases)
 */
export function getSocket(): Socket | null {
  return socket
}

// =============================================================================
// Event Handlers
// =============================================================================

function handleNewEvent(data: SocketEventData) {
  const store = useMessageStore.getState()

  // Convert socket data to StreamEvent
  const event: StreamEvent = {
    id: data.id,
    streamId: data.streamId,
    eventType: data.eventType as StreamEvent["eventType"],
    actorId: data.actorId || "",
    actorEmail: data.actorEmail,
    actorName: data.actorName,
    agentId: data.agentId,
    content: data.content,
    mentions: data.mentions as StreamEvent["mentions"],
    payload: data.payload,
    createdAt: data.createdAt,
    clientMessageId: data.clientMessageId,
  }

  // Add to store (handles deduplication and outbox confirmation internally)
  store.addEvent(data.streamId, event)

  // If this confirms an outbox message, remove it
  if (data.clientMessageId) {
    const outbox = store.outbox
    const matchingOutbox = outbox.find((m) => m.id === data.clientMessageId)
    if (matchingOutbox) {
      store.removeFromOutbox(data.clientMessageId)
    }
  }
}

function handleEventEdited(data: EventEditedData) {
  const store = useMessageStore.getState()

  // Find which stream this event belongs to
  for (const [streamId, cache] of store.events) {
    if (cache.events.some((e) => e.id === data.id)) {
      store.updateEvent(streamId, data.id, {
        content: data.content,
        isEdited: true,
        editedAt: data.editedAt,
      })
      break
    }
  }
}

function handleEventDeleted(data: EventDeletedData) {
  const store = useMessageStore.getState()

  // Find which stream this event belongs to
  for (const [streamId, cache] of store.events) {
    if (cache.events.some((e) => e.id === data.id)) {
      store.removeEvent(streamId, data.id)
      break
    }
  }
}

function handleStreamUpdated(data: StreamUpdatedData) {
  const store = useMessageStore.getState()
  store.updateStream(data.id, data as Partial<Stream>)
}

function handleReplyCountUpdated(data: ReplyCountData) {
  const store = useMessageStore.getState()

  // Find which stream this event belongs to and update reply count
  for (const [streamId, cache] of store.events) {
    if (cache.events.some((e) => e.id === data.eventId)) {
      store.updateEvent(streamId, data.eventId, {
        replyCount: data.replyCount,
      })
      break
    }
  }
}

function handleThreadCreated(data: ThreadCreatedData) {
  // Server may send branchedFromEventId with or without event_ prefix
  // We join rooms with raw event ID, so strip prefix for comparison
  const rawEventId = data.branchedFromEventId.replace(/^event_/, "")

  // Check if we're viewing the pending thread
  if (!joinedStreams.has(rawEventId)) {
    return
  }

  const store = useMessageStore.getState()
  const pendingKey = `event_${rawEventId}`

  console.log(`[SocketWorker] Thread created: ${pendingKey} -> ${data.threadId}`)

  // Create alias so events for realThreadId also update pendingKey cache
  store.addStreamAlias(data.threadId, pendingKey)

  // Join the real thread's room to receive future events
  if (socket && currentWorkspaceId) {
    joinedStreams.add(data.threadId)
    socket.emit("join", room.stream(currentWorkspaceId, data.threadId))
    console.log(`[SocketWorker] Joined real thread ${data.threadId}`)
  }

  // Fetch the real thread data and update the store
  fetchRealThread(data.threadId, pendingKey)
}

async function fetchRealThread(threadId: string, pendingKey: string) {
  if (!currentWorkspaceId) return

  try {
    // Fetch thread metadata
    const threadRes = await fetch(`/api/workspace/${currentWorkspaceId}/streams/${threadId}`, {
      credentials: "include",
    })

    if (!threadRes.ok) return

    const threadData = await threadRes.json()
    const store = useMessageStore.getState()

    // Update the pending key with real thread data
    store.setStream(pendingKey, {
      stream: threadData.stream,
      parentStream: threadData.parentStream,
      rootEvent: threadData.rootEvent,
      ancestors: threadData.ancestors || [],
      lastFetchedAt: Date.now(),
    })

    // Fetch events for the real thread
    const eventsRes = await fetch(
      `/api/workspace/${currentWorkspaceId}/streams/${threadId}/events?limit=50`,
      { credentials: "include" },
    )

    if (eventsRes.ok) {
      const eventsData = await eventsRes.json()
      store.setEvents(pendingKey, {
        events: eventsData.events || [],
        hasMore: eventsData.hasMore || false,
        lastFetchedAt: Date.now(),
        lastReadEventId: eventsData.lastReadEventId,
      })
    }
  } catch (error) {
    console.error("[SocketWorker] Failed to fetch real thread:", error)
  }
}
