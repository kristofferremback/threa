/**
 * Stream Fetcher
 *
 * Functions to fetch stream and event data from the API
 * and populate the zustand store.
 *
 * These are called:
 * - When opening a stream (to get initial data)
 * - On reconnect (to refresh stale data)
 * - When loading more events (pagination)
 */

import { useMessageStore } from "../stores/message-store"
import { streamApi } from "../../shared/api"
import { joinStream, onReconnect } from "./socket-worker"
import type { StreamEvent } from "../types"

// =============================================================================
// Configuration
// =============================================================================

const CACHE_STALE_MS = 30000 // Consider cache stale after 30 seconds

// =============================================================================
// Track Active Fetches (prevent duplicate concurrent fetches)
// =============================================================================

const activeFetches = new Map<string, Promise<void>>()

// =============================================================================
// Stream Fetcher
// =============================================================================

/**
 * Fetch a stream and its metadata, updating the store.
 * Returns cached data immediately if available.
 */
export async function fetchStream(workspaceId: string, streamId: string): Promise<void> {
  const store = useMessageStore.getState()
  const cached = store.streams.get(streamId)

  // If we have fresh cached data, skip fetch
  if (cached && Date.now() - cached.lastFetchedAt < CACHE_STALE_MS) {
    return
  }

  // Prevent duplicate concurrent fetches
  const fetchKey = `stream:${streamId}`
  const existing = activeFetches.get(fetchKey)
  if (existing) {
    return existing
  }

  const fetchPromise = (async () => {
    try {
      const response = await streamApi.getStream(workspaceId, streamId)

      store.setStream(streamId, {
        stream: response.stream,
        parentStream: response.parentStream,
        rootEvent: response.rootEvent,
        ancestors: response.ancestors || [],
        lastFetchedAt: Date.now(),
      })
    } catch (error) {
      console.error(`[StreamFetcher] Failed to fetch stream ${streamId}:`, error)
      throw error
    } finally {
      activeFetches.delete(fetchKey)
    }
  })()

  activeFetches.set(fetchKey, fetchPromise)
  return fetchPromise
}

/**
 * Fetch events for a stream, updating the store.
 * Returns cached data immediately if available.
 */
export async function fetchEvents(
  workspaceId: string,
  streamId: string,
  options?: { force?: boolean; cursor?: string },
): Promise<void> {
  const store = useMessageStore.getState()
  const cached = store.events.get(streamId)
  const isLoadMore = !!options?.cursor

  // If we have fresh cached data and not loading more, skip fetch
  if (!options?.force && !isLoadMore && cached && Date.now() - cached.lastFetchedAt < CACHE_STALE_MS) {
    return
  }

  // Prevent duplicate concurrent fetches (but allow load more)
  const fetchKey = isLoadMore ? `events:${streamId}:${options.cursor}` : `events:${streamId}`
  const existing = activeFetches.get(fetchKey)
  if (existing) {
    return existing
  }

  const fetchPromise = (async () => {
    try {
      const response = await streamApi.getEvents(workspaceId, streamId, {
        cursor: options?.cursor,
        limit: 50,
      })

      if (isLoadMore) {
        // Prepend older events
        store.prependEvents(streamId, response.events, response.hasMore, response.nextCursor)
      } else {
        // Replace/set events
        store.setEvents(streamId, {
          events: response.events,
          hasMore: response.hasMore,
          nextCursor: response.nextCursor,
          lastFetchedAt: Date.now(),
          lastReadEventId: response.lastReadEventId,
        })
      }
    } catch (error) {
      console.error(`[StreamFetcher] Failed to fetch events for ${streamId}:`, error)
      throw error
    } finally {
      activeFetches.delete(fetchKey)
    }
  })()

  activeFetches.set(fetchKey, fetchPromise)
  return fetchPromise
}

/**
 * Initialize a stream view:
 * 1. Return cached data immediately (for instant display)
 * 2. Join the socket room
 * 3. Fetch fresh data in background
 *
 * Returns whether cached data was available.
 */
export function initStreamView(workspaceId: string, streamId: string): boolean {
  const store = useMessageStore.getState()
  const hasCachedStream = store.streams.has(streamId)
  const hasCachedEvents = store.events.has(streamId)

  // Join socket room immediately
  joinStream(streamId)

  // Start background fetch
  Promise.all([fetchStream(workspaceId, streamId), fetchEvents(workspaceId, streamId)]).catch((error) => {
    console.error(`[StreamFetcher] Failed to init stream view for ${streamId}:`, error)
  })

  return hasCachedStream || hasCachedEvents
}

/**
 * Load more (older) events for a stream.
 */
export async function loadMoreEvents(workspaceId: string, streamId: string): Promise<boolean> {
  const store = useMessageStore.getState()
  const cached = store.events.get(streamId)

  if (!cached || !cached.hasMore || !cached.nextCursor) {
    return false // Nothing more to load
  }

  await fetchEvents(workspaceId, streamId, { cursor: cached.nextCursor })
  return true
}

/**
 * Setup reconnect handler to refresh stale data.
 * Call this once when initializing the app.
 */
export function setupReconnectRefresh(workspaceId: string) {
  return onReconnect(() => {
    const store = useMessageStore.getState()

    // Refresh all cached streams that are stale
    for (const [streamId, cache] of store.streams) {
      if (Date.now() - cache.lastFetchedAt > CACHE_STALE_MS) {
        fetchStream(workspaceId, streamId).catch(() => {})
        fetchEvents(workspaceId, streamId, { force: true }).catch(() => {})
      }
    }
  })
}

// =============================================================================
// Merge Outbox with Events
// =============================================================================

/**
 * Get events for a stream, merged with any pending outbox messages.
 * This is what the UI should call to get the complete event list.
 */
export function getMergedEvents(workspaceId: string, streamId: string): StreamEvent[] {
  const store = useMessageStore.getState()
  const cached = store.events.get(streamId)
  const events = cached?.events || []

  // Get outbox messages for this stream
  const outboxMessages = store.outbox.filter((m) => m.workspaceId === workspaceId && m.streamId === streamId)

  // Convert outbox messages to StreamEvent format
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

  // Merge: events that aren't in outbox + outbox events
  const outboxIds = new Set(outboxMessages.map((m) => m.id))
  const serverEvents = events.filter((e) => !outboxIds.has(e.id))

  // Sort by createdAt
  return [...serverEvents, ...outboxEvents].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
}
