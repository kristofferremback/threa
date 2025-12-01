/**
 * Message Cache - Cache stream events for offline viewing
 *
 * Provides caching layer for stream events with automatic pruning.
 */

import type { StreamEvent, Stream } from "../../types"
import {
  cacheEvents as dbCacheEvents,
  getCachedEvents as dbGetCachedEvents,
  getCachedEvent as dbGetCachedEvent,
  updateCachedEvent as dbUpdateCachedEvent,
  deleteCachedEvent as dbDeleteCachedEvent,
  deleteEventsForStream as dbDeleteEventsForStream,
  cacheStream as dbCacheStream,
  getCachedStream as dbGetCachedStream,
  getCachedStreams as dbGetCachedStreams,
  deleteCachedStream as dbDeleteCachedStream,
  getSyncState,
  setSyncState,
  isIndexedDBAvailable,
  type CachedEvent,
  type CachedStream,
  type SyncState,
} from "./db"

export type { CachedEvent, CachedStream }

// ==========================================================================
// Stream Caching
// ==========================================================================

/**
 * Cache a stream's metadata
 */
export async function cacheStream(stream: Stream): Promise<void> {
  if (!isIndexedDBAvailable()) return

  try {
    await dbCacheStream(stream)
  } catch (err) {
    console.warn("[MessageCache] Failed to cache stream:", err)
  }
}

/**
 * Get a cached stream
 */
export async function getCachedStream(streamId: string): Promise<CachedStream | null> {
  if (!isIndexedDBAvailable()) return null

  try {
    return await dbGetCachedStream(streamId)
  } catch (err) {
    console.warn("[MessageCache] Failed to get cached stream:", err)
    return null
  }
}

/**
 * Get all cached streams for a workspace
 */
export async function getCachedStreams(workspaceId: string): Promise<CachedStream[]> {
  if (!isIndexedDBAvailable()) return []

  try {
    return await dbGetCachedStreams(workspaceId)
  } catch (err) {
    console.warn("[MessageCache] Failed to get cached streams:", err)
    return []
  }
}

/**
 * Remove a cached stream and its events
 */
export async function removeCachedStream(streamId: string): Promise<void> {
  if (!isIndexedDBAvailable()) return

  try {
    await dbDeleteCachedStream(streamId)
    await dbDeleteEventsForStream(streamId)
  } catch (err) {
    console.warn("[MessageCache] Failed to remove cached stream:", err)
  }
}

// ==========================================================================
// Event Caching
// ==========================================================================

/**
 * Cache events for a stream
 */
export async function cacheEvents(streamId: string, events: StreamEvent[]): Promise<void> {
  if (!isIndexedDBAvailable() || events.length === 0) return

  try {
    await dbCacheEvents(events)

    // Update sync state
    const sortedEvents = [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const oldestEvent = sortedEvents[0]
    const newestEvent = sortedEvents[sortedEvents.length - 1]

    const existingState = await getSyncState(streamId)
    await setSyncState({
      id: streamId,
      lastSyncAt: Date.now(),
      oldestEventId: existingState?.oldestEventId || oldestEvent.id,
      newestEventId: newestEvent.id,
    })
  } catch (err) {
    console.warn("[MessageCache] Failed to cache events:", err)
  }
}

/**
 * Get cached events for a stream
 */
export async function getCachedEvents(streamId: string, options: { limit?: number } = {}): Promise<StreamEvent[]> {
  if (!isIndexedDBAvailable()) return []

  try {
    const events = await dbGetCachedEvents(streamId, options)
    // Strip the cachedAt field to return clean StreamEvent objects
    return events.map(({ cachedAt: _, ...event }) => event as StreamEvent)
  } catch (err) {
    console.warn("[MessageCache] Failed to get cached events:", err)
    return []
  }
}

/**
 * Get a single cached event
 */
export async function getCachedEvent(eventId: string): Promise<StreamEvent | null> {
  if (!isIndexedDBAvailable()) return null

  try {
    const event = await dbGetCachedEvent(eventId)
    if (!event) return null
    const { cachedAt: _, ...cleanEvent } = event
    return cleanEvent as StreamEvent
  } catch (err) {
    console.warn("[MessageCache] Failed to get cached event:", err)
    return null
  }
}

/**
 * Merge a single event into the cache (for real-time updates)
 */
export async function mergeEvent(event: StreamEvent): Promise<void> {
  if (!isIndexedDBAvailable()) return

  try {
    await dbCacheEvents([event])
  } catch (err) {
    console.warn("[MessageCache] Failed to merge event:", err)
  }
}

/**
 * Update a cached event (for edits)
 */
export async function updateCachedEvent(eventId: string, updates: Partial<StreamEvent>): Promise<void> {
  if (!isIndexedDBAvailable()) return

  try {
    await dbUpdateCachedEvent({ id: eventId, ...updates })
  } catch (err) {
    console.warn("[MessageCache] Failed to update cached event:", err)
  }
}

/**
 * Delete a cached event
 */
export async function deleteCachedEvent(eventId: string): Promise<void> {
  if (!isIndexedDBAvailable()) return

  try {
    await dbDeleteCachedEvent(eventId)
  } catch (err) {
    console.warn("[MessageCache] Failed to delete cached event:", err)
  }
}

/**
 * Clear all cached events for a stream
 */
export async function clearStreamCache(streamId: string): Promise<void> {
  if (!isIndexedDBAvailable()) return

  try {
    await dbDeleteEventsForStream(streamId)
  } catch (err) {
    console.warn("[MessageCache] Failed to clear stream cache:", err)
  }
}

// ==========================================================================
// Sync State
// ==========================================================================

/**
 * Get the sync state for a stream
 */
export async function getStreamSyncState(streamId: string): Promise<SyncState | null> {
  if (!isIndexedDBAvailable()) return null

  try {
    return await getSyncState(streamId)
  } catch (err) {
    console.warn("[MessageCache] Failed to get sync state:", err)
    return null
  }
}

/**
 * Check if a stream has cached data
 */
export async function hasCache(streamId: string): Promise<boolean> {
  if (!isIndexedDBAvailable()) return false

  try {
    const events = await dbGetCachedEvents(streamId, { limit: 1 })
    return events.length > 0
  } catch {
    return false
  }
}

/**
 * Get cache freshness (time since last sync)
 */
export async function getCacheFreshness(streamId: string): Promise<number | null> {
  if (!isIndexedDBAvailable()) return null

  try {
    const state = await getSyncState(streamId)
    if (!state) return null
    return Date.now() - state.lastSyncAt
  } catch {
    return null
  }
}

// Consider cache stale after 5 minutes
const STALE_THRESHOLD_MS = 5 * 60 * 1000

/**
 * Check if cache is stale and should be refreshed
 */
export async function isCacheStale(streamId: string): Promise<boolean> {
  const freshness = await getCacheFreshness(streamId)
  if (freshness === null) return true
  return freshness > STALE_THRESHOLD_MS
}
