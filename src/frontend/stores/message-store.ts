/**
 * Message Store
 *
 * Centralized store for all message-related state using zustand.
 * This is the single source of truth for:
 * - Stream metadata
 * - Stream events (messages)
 * - Outbox (pending messages waiting to be sent)
 *
 * Architecture:
 * - UI only reads from this store
 * - Writes go through actions which update the store
 * - Background workers (outbox, socket, fetcher) update the store
 * - localStorage persistence for outbox (survives page refresh)
 */

import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"
import type { Stream, StreamEvent, Mention } from "../types"

// =============================================================================
// Types
// =============================================================================

export type OutboxStatus = "pending" | "sending" | "failed"

export interface OutboxMessage {
  id: string // Temporary ID (temp_xxx) - also used as clientMessageId
  workspaceId: string
  streamId: string
  content: string
  mentions?: Mention[]
  actorId: string
  actorEmail: string
  createdAt: string
  status: OutboxStatus
  lastError?: string
  retryCount: number
  // For pending threads (streamId starts with "event_")
  parentEventId?: string
  parentStreamId?: string
}

interface StreamCache {
  stream: Stream
  parentStream?: Stream
  rootEvent?: StreamEvent
  ancestors: StreamEvent[]
  lastFetchedAt: number
}

interface EventsCache {
  events: StreamEvent[]
  hasMore: boolean
  nextCursor?: string
  lastFetchedAt: number
  lastReadEventId?: string
}

interface MessageState {
  // Cache
  streams: Map<string, StreamCache> // streamId -> StreamCache
  events: Map<string, EventsCache> // streamId -> EventsCache

  // Outbox
  outbox: OutboxMessage[]

  // Connection state
  isOnline: boolean
  isWebSocketConnected: boolean
}

interface MessageActions {
  // Stream cache actions
  setStream: (streamId: string, cache: StreamCache) => void
  updateStream: (streamId: string, partial: Partial<Stream>) => void
  removeStream: (streamId: string) => void

  // Events cache actions
  setEvents: (streamId: string, cache: EventsCache) => void
  addEvent: (streamId: string, event: StreamEvent) => void
  updateEvent: (streamId: string, eventId: string, partial: Partial<StreamEvent>) => void
  removeEvent: (streamId: string, eventId: string) => void
  prependEvents: (streamId: string, events: StreamEvent[], hasMore: boolean, nextCursor?: string) => void

  // Outbox actions
  addToOutbox: (message: Omit<OutboxMessage, "status" | "retryCount">) => void
  updateOutboxStatus: (id: string, status: OutboxStatus, error?: string) => void
  removeFromOutbox: (id: string) => void
  getNextPendingMessage: () => OutboxMessage | undefined
  resetSendingToRetry: () => void

  // Connection state
  setOnline: (online: boolean) => void
  setWebSocketConnected: (connected: boolean) => void

  // Persistence
  loadOutboxFromStorage: () => void
  saveOutboxToStorage: () => void
}

type MessageStore = MessageState & MessageActions

// =============================================================================
// Storage Key
// =============================================================================

const OUTBOX_STORAGE_KEY = "threa-message-outbox-v2"

// =============================================================================
// Store
// =============================================================================

export const useMessageStore = create<MessageStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    streams: new Map(),
    events: new Map(),
    outbox: [],
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    isWebSocketConnected: false,

    // Stream cache actions
    setStream: (streamId, cache) => {
      set((state) => {
        const newStreams = new Map(state.streams)
        newStreams.set(streamId, cache)
        return { streams: newStreams }
      })
    },

    updateStream: (streamId, partial) => {
      set((state) => {
        const existing = state.streams.get(streamId)
        if (!existing) return state

        const newStreams = new Map(state.streams)
        newStreams.set(streamId, {
          ...existing,
          stream: { ...existing.stream, ...partial },
        })
        return { streams: newStreams }
      })
    },

    removeStream: (streamId) => {
      set((state) => {
        const newStreams = new Map(state.streams)
        newStreams.delete(streamId)
        return { streams: newStreams }
      })
    },

    // Events cache actions
    setEvents: (streamId, cache) => {
      set((state) => {
        const newEvents = new Map(state.events)
        newEvents.set(streamId, cache)
        return { events: newEvents }
      })
    },

    addEvent: (streamId, event) => {
      set((state) => {
        const existing = state.events.get(streamId)
        if (!existing) {
          // No cache yet, create one
          const newEvents = new Map(state.events)
          newEvents.set(streamId, {
            events: [event],
            hasMore: false,
            lastFetchedAt: Date.now(),
          })
          return { events: newEvents }
        }

        // Check for duplicates by ID
        if (existing.events.some((e) => e.id === event.id)) {
          return state
        }

        // Check if this event confirms an outbox message (clientMessageId match)
        const confirmsOutbox = event.clientMessageId && existing.events.some((e) => e.id === event.clientMessageId)

        const newEvents = new Map(state.events)
        if (confirmsOutbox) {
          // Replace the temp event with the real one
          newEvents.set(streamId, {
            ...existing,
            events: existing.events.map((e) =>
              e.id === event.clientMessageId ? { ...event, pending: false, sendFailed: false } : e,
            ),
          })
        } else {
          // Add new event at the end (sorted by createdAt)
          const events = [...existing.events, event].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          )
          newEvents.set(streamId, { ...existing, events })
        }

        return { events: newEvents }
      })
    },

    updateEvent: (streamId, eventId, partial) => {
      set((state) => {
        const existing = state.events.get(streamId)
        if (!existing) return state

        const newEvents = new Map(state.events)
        newEvents.set(streamId, {
          ...existing,
          events: existing.events.map((e) => (e.id === eventId ? { ...e, ...partial } : e)),
        })
        return { events: newEvents }
      })
    },

    removeEvent: (streamId, eventId) => {
      set((state) => {
        const existing = state.events.get(streamId)
        if (!existing) return state

        const newEvents = new Map(state.events)
        newEvents.set(streamId, {
          ...existing,
          events: existing.events.filter((e) => e.id !== eventId),
        })
        return { events: newEvents }
      })
    },

    prependEvents: (streamId, events, hasMore, nextCursor) => {
      set((state) => {
        const existing = state.events.get(streamId)
        const newEvents = new Map(state.events)

        if (!existing) {
          newEvents.set(streamId, {
            events,
            hasMore,
            nextCursor,
            lastFetchedAt: Date.now(),
          })
        } else {
          // Prepend events, avoiding duplicates
          const existingIds = new Set(existing.events.map((e) => e.id))
          const newEventsToAdd = events.filter((e) => !existingIds.has(e.id))
          newEvents.set(streamId, {
            ...existing,
            events: [...newEventsToAdd, ...existing.events],
            hasMore,
            nextCursor,
            lastFetchedAt: Date.now(),
          })
        }

        return { events: newEvents }
      })
    },

    // Outbox actions
    addToOutbox: (message) => {
      const outboxMessage: OutboxMessage = {
        ...message,
        status: "pending",
        retryCount: 0,
      }

      set((state) => {
        const newOutbox = [...state.outbox, outboxMessage]
        return { outbox: newOutbox }
      })

      // Also add to events cache for immediate display
      const tempEvent: StreamEvent = {
        id: message.id,
        streamId: message.streamId,
        eventType: "message",
        actorId: message.actorId,
        actorEmail: message.actorEmail,
        content: message.content,
        mentions: message.mentions,
        createdAt: message.createdAt,
        pending: true,
      }
      get().addEvent(message.streamId, tempEvent)

      // Persist to localStorage
      get().saveOutboxToStorage()
    },

    updateOutboxStatus: (id, status, error) => {
      set((state) => {
        const newOutbox = state.outbox.map((m) => {
          if (m.id !== id) return m
          return {
            ...m,
            status,
            lastError: error,
            retryCount: status === "failed" ? m.retryCount + 1 : m.retryCount,
          }
        })
        return { outbox: newOutbox }
      })

      // Update the corresponding event in cache
      const message = get().outbox.find((m) => m.id === id)
      if (message) {
        get().updateEvent(message.streamId, id, {
          pending: status === "pending" || status === "sending",
          sendFailed: status === "failed",
        })
      }

      get().saveOutboxToStorage()
    },

    removeFromOutbox: (id) => {
      const message = get().outbox.find((m) => m.id === id)

      set((state) => ({
        outbox: state.outbox.filter((m) => m.id !== id),
      }))

      // Mark event as no longer pending (it's now confirmed)
      if (message) {
        get().updateEvent(message.streamId, id, {
          pending: false,
          sendFailed: false,
        })
      }

      get().saveOutboxToStorage()
    },

    getNextPendingMessage: () => {
      const { outbox } = get()
      // Get the oldest pending or failed message (not currently sending)
      return outbox.find((m) => m.status === "pending" || m.status === "failed")
    },

    resetSendingToRetry: () => {
      // Reset any "sending" messages back to "pending" (e.g., on page load)
      set((state) => ({
        outbox: state.outbox.map((m) => (m.status === "sending" ? { ...m, status: "pending" as const } : m)),
      }))
      get().saveOutboxToStorage()
    },

    // Connection state
    setOnline: (online) => set({ isOnline: online }),
    setWebSocketConnected: (connected) => set({ isWebSocketConnected: connected }),

    // Persistence
    loadOutboxFromStorage: () => {
      try {
        const data = localStorage.getItem(OUTBOX_STORAGE_KEY)
        if (data) {
          const outbox = JSON.parse(data) as OutboxMessage[]
          set({ outbox })

          // Also populate events cache with pending messages
          for (const msg of outbox) {
            const tempEvent: StreamEvent = {
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
            get().addEvent(msg.streamId, tempEvent)
          }
        }
      } catch {
        // Ignore parse errors
      }
    },

    saveOutboxToStorage: () => {
      try {
        localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(get().outbox))
        // Notify other tabs
        window.dispatchEvent(new StorageEvent("storage", { key: OUTBOX_STORAGE_KEY }))
      } catch {
        // Ignore quota errors
      }
    },
  })),
)

// =============================================================================
// Selectors (for efficient subscriptions)
// =============================================================================

export const selectStream = (streamId: string) => (state: MessageStore) => state.streams.get(streamId)

export const selectEvents = (streamId: string) => (state: MessageStore) => state.events.get(streamId)

export const selectOutboxForStream = (workspaceId: string, streamId: string) => (state: MessageStore) =>
  state.outbox.filter((m) => m.workspaceId === workspaceId && m.streamId === streamId)

export const selectPendingCount = () => (state: MessageStore) =>
  state.outbox.filter((m) => m.status === "pending" || m.status === "sending").length

// =============================================================================
// Helper to generate temp IDs
// =============================================================================

export function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}
