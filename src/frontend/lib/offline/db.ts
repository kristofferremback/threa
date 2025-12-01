/**
 * IndexedDB wrapper for Threa offline storage
 *
 * Provides type-safe access to IndexedDB with automatic migrations.
 * Uses native IndexedDB API for minimal dependencies.
 */

import type { Stream, StreamEvent, Mention } from "../../types"

const DB_NAME = "threa-offline"
const DB_VERSION = 1

// Store names
const STORES = {
  streams: "streams",
  events: "events",
  drafts: "drafts",
  outbox: "outbox",
  syncState: "syncState",
} as const

// Types for stored data
export interface CachedStream extends Stream {
  cachedAt: number
}

export interface CachedEvent extends StreamEvent {
  cachedAt: number
}

export interface Draft {
  streamId: string
  content: string
  mentions: Mention[]
  updatedAt: number
}

export type OutboxStatus = "pending" | "sending" | "failed"

export interface OutboxMessage {
  id: string
  workspaceId: string
  streamId: string
  content: string
  mentions: Mention[]
  createdAt: number
  status: OutboxStatus
  retryCount: number
  lastError?: string
  // For pending threads
  parentEventId?: string
  parentStreamId?: string
}

export interface SyncState {
  id: string
  lastSyncAt: number
  oldestEventId?: string
  newestEventId?: string
}

// Database instance singleton
let dbPromise: Promise<IDBDatabase> | null = null
let dbInstance: IDBDatabase | null = null

/**
 * Open the IndexedDB database with migrations
 */
export function openDB(): Promise<IDBDatabase> {
  // Check if existing connection is still usable
  if (dbInstance) {
    try {
      // Test if connection is still valid by checking if we can create a transaction
      // This will throw if the connection is closed or the database was deleted
      dbInstance.transaction(STORES.drafts, "readonly")
      return Promise.resolve(dbInstance)
    } catch {
      // Connection is stale, clear it and reconnect
      dbInstance = null
      dbPromise = null
    }
  }

  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      dbPromise = null
      dbInstance = null
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`))
    }

    request.onsuccess = () => {
      dbInstance = request.result

      // Handle connection closing unexpectedly
      dbInstance.onclose = () => {
        dbInstance = null
        dbPromise = null
      }

      // Handle version change (database deleted or upgraded by another tab)
      dbInstance.onversionchange = () => {
        dbInstance?.close()
        dbInstance = null
        dbPromise = null
      }

      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create streams store
      if (!db.objectStoreNames.contains(STORES.streams)) {
        const streamsStore = db.createObjectStore(STORES.streams, { keyPath: "id" })
        streamsStore.createIndex("workspaceId", "workspaceId", { unique: false })
        streamsStore.createIndex("cachedAt", "cachedAt", { unique: false })
      }

      // Create events store
      if (!db.objectStoreNames.contains(STORES.events)) {
        const eventsStore = db.createObjectStore(STORES.events, { keyPath: "id" })
        eventsStore.createIndex("streamId", "streamId", { unique: false })
        eventsStore.createIndex("createdAt", "createdAt", { unique: false })
        eventsStore.createIndex("streamId_createdAt", ["streamId", "createdAt"], { unique: false })
        eventsStore.createIndex("cachedAt", "cachedAt", { unique: false })
      }

      // Create drafts store
      if (!db.objectStoreNames.contains(STORES.drafts)) {
        db.createObjectStore(STORES.drafts, { keyPath: "streamId" })
      }

      // Create outbox store
      if (!db.objectStoreNames.contains(STORES.outbox)) {
        const outboxStore = db.createObjectStore(STORES.outbox, { keyPath: "id" })
        outboxStore.createIndex("streamId", "streamId", { unique: false })
        outboxStore.createIndex("status", "status", { unique: false })
        outboxStore.createIndex("createdAt", "createdAt", { unique: false })
      }

      // Create sync state store
      if (!db.objectStoreNames.contains(STORES.syncState)) {
        db.createObjectStore(STORES.syncState, { keyPath: "id" })
      }
    }
  })

  return dbPromise
}

/**
 * Close the database connection (for logout/cleanup)
 */
export async function closeDB(): Promise<void> {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
  dbPromise = null
}

/**
 * Delete the entire database (for logout/cleanup)
 */
export function deleteDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Close existing connection first
    if (dbInstance) {
      dbInstance.close()
      dbInstance = null
    }
    dbPromise = null

    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onerror = () => reject(new Error(`Failed to delete IndexedDB: ${request.error?.message}`))
    request.onsuccess = () => resolve()
  })
}

// Generic transaction helpers
type StoreName = (typeof STORES)[keyof typeof STORES]

async function getStore(storeName: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDB()
  const tx = db.transaction(storeName, mode)
  return tx.objectStore(storeName)
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// ==========================================================================
// Streams Store Operations
// ==========================================================================

export async function cacheStream(stream: Stream): Promise<void> {
  const store = await getStore(STORES.streams, "readwrite")
  const cached: CachedStream = { ...stream, cachedAt: Date.now() }
  await promisifyRequest(store.put(cached))
}

export async function getCachedStream(streamId: string): Promise<CachedStream | null> {
  const store = await getStore(STORES.streams, "readonly")
  const result = await promisifyRequest(store.get(streamId))
  return result || null
}

export async function getCachedStreams(workspaceId: string): Promise<CachedStream[]> {
  const store = await getStore(STORES.streams, "readonly")
  const index = store.index("workspaceId")
  return promisifyRequest(index.getAll(workspaceId))
}

export async function deleteCachedStream(streamId: string): Promise<void> {
  const store = await getStore(STORES.streams, "readwrite")
  await promisifyRequest(store.delete(streamId))
}

// ==========================================================================
// Events Store Operations
// ==========================================================================

export async function cacheEvents(events: StreamEvent[]): Promise<void> {
  if (events.length === 0) return

  const db = await openDB()
  const tx = db.transaction(STORES.events, "readwrite")
  const store = tx.objectStore(STORES.events)
  const now = Date.now()

  for (const event of events) {
    const cached: CachedEvent = { ...event, cachedAt: now }
    store.put(cached)
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getCachedEvents(
  streamId: string,
  options: { limit?: number; before?: string } = {},
): Promise<CachedEvent[]> {
  const store = await getStore(STORES.events, "readonly")
  const index = store.index("streamId_createdAt")

  // Get all events for this stream
  const range = IDBKeyRange.bound([streamId, ""], [streamId, "\uffff"])

  return new Promise((resolve, reject) => {
    const events: CachedEvent[] = []
    const request = index.openCursor(range, "prev") // newest first

    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        const event = cursor.value as CachedEvent

        // If we have a 'before' cursor, skip until we find it
        if (options.before && event.id === options.before) {
          cursor.continue()
          return
        }

        events.push(event)

        if (options.limit && events.length >= options.limit) {
          // Reverse to get chronological order and return
          resolve(events.reverse())
          return
        }

        cursor.continue()
      } else {
        // No more results
        resolve(events.reverse())
      }
    }

    request.onerror = () => reject(request.error)
  })
}

export async function getCachedEvent(eventId: string): Promise<CachedEvent | null> {
  const store = await getStore(STORES.events, "readonly")
  const result = await promisifyRequest(store.get(eventId))
  return result || null
}

export async function updateCachedEvent(event: Partial<StreamEvent> & { id: string }): Promise<void> {
  const store = await getStore(STORES.events, "readwrite")
  const existing = await promisifyRequest(store.get(event.id))
  if (existing) {
    const updated = { ...existing, ...event, cachedAt: Date.now() }
    await promisifyRequest(store.put(updated))
  }
}

export async function deleteCachedEvent(eventId: string): Promise<void> {
  const store = await getStore(STORES.events, "readwrite")
  await promisifyRequest(store.delete(eventId))
}

export async function deleteEventsForStream(streamId: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORES.events, "readwrite")
  const store = tx.objectStore(STORES.events)
  const index = store.index("streamId")

  return new Promise((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(streamId))

    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ==========================================================================
// Drafts Store Operations
// ==========================================================================

export async function saveDraft(draft: Draft): Promise<void> {
  const store = await getStore(STORES.drafts, "readwrite")
  await promisifyRequest(store.put(draft))
}

export async function getDraft(streamId: string): Promise<Draft | null> {
  const store = await getStore(STORES.drafts, "readonly")
  const result = await promisifyRequest(store.get(streamId))
  return result || null
}

export async function deleteDraft(streamId: string): Promise<void> {
  const store = await getStore(STORES.drafts, "readwrite")
  await promisifyRequest(store.delete(streamId))
}

export async function getAllDrafts(): Promise<Draft[]> {
  const store = await getStore(STORES.drafts, "readonly")
  return promisifyRequest(store.getAll())
}

// ==========================================================================
// Outbox Store Operations
// ==========================================================================

export async function addToOutbox(message: OutboxMessage): Promise<void> {
  const store = await getStore(STORES.outbox, "readwrite")
  await promisifyRequest(store.put(message))
}

export async function getOutboxMessage(id: string): Promise<OutboxMessage | null> {
  const store = await getStore(STORES.outbox, "readonly")
  const result = await promisifyRequest(store.get(id))
  return result || null
}

export async function getOutboxForStream(streamId: string): Promise<OutboxMessage[]> {
  const store = await getStore(STORES.outbox, "readonly")
  const index = store.index("streamId")
  return promisifyRequest(index.getAll(streamId))
}

export async function getAllPendingOutbox(): Promise<OutboxMessage[]> {
  const store = await getStore(STORES.outbox, "readonly")
  const index = store.index("status")
  const pending = await promisifyRequest(index.getAll("pending"))
  const failed = await promisifyRequest(index.getAll("failed"))
  return [...pending, ...failed].sort((a, b) => a.createdAt - b.createdAt)
}

export async function updateOutboxStatus(
  id: string,
  status: OutboxStatus,
  error?: string,
): Promise<void> {
  const store = await getStore(STORES.outbox, "readwrite")
  const existing = await promisifyRequest(store.get(id))
  if (existing) {
    const updated: OutboxMessage = {
      ...existing,
      status,
      retryCount: status === "failed" ? existing.retryCount + 1 : existing.retryCount,
      lastError: error,
    }
    await promisifyRequest(store.put(updated))
  }
}

export async function removeFromOutbox(id: string): Promise<void> {
  const store = await getStore(STORES.outbox, "readwrite")
  await promisifyRequest(store.delete(id))
}

export async function clearOutbox(): Promise<void> {
  const store = await getStore(STORES.outbox, "readwrite")
  await promisifyRequest(store.clear())
}

// ==========================================================================
// Sync State Store Operations
// ==========================================================================

export async function getSyncState(id: string): Promise<SyncState | null> {
  const store = await getStore(STORES.syncState, "readonly")
  const result = await promisifyRequest(store.get(id))
  return result || null
}

export async function setSyncState(state: SyncState): Promise<void> {
  const store = await getStore(STORES.syncState, "readwrite")
  await promisifyRequest(store.put(state))
}

// ==========================================================================
// Cache Pruning
// ==========================================================================

const MAX_EVENTS_PER_STREAM = 500
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function pruneCache(): Promise<{ eventsDeleted: number; streamsDeleted: number }> {
  try {
    const db = await openDB()
    let eventsDeleted = 0
    let streamsDeleted = 0
    const now = Date.now()
    const cutoff = now - MAX_CACHE_AGE_MS

    // Prune old events
    const eventsTx = db.transaction(STORES.events, "readwrite")
  const eventsStore = eventsTx.objectStore(STORES.events)
  const cachedAtIndex = eventsStore.index("cachedAt")

  await new Promise<void>((resolve, reject) => {
    const range = IDBKeyRange.upperBound(cutoff)
    const request = cachedAtIndex.openCursor(range)

    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        cursor.delete()
        eventsDeleted++
        cursor.continue()
      }
    }

    eventsTx.oncomplete = () => resolve()
    eventsTx.onerror = () => reject(eventsTx.error)
  })

  // Prune excess events per stream (keep only MAX_EVENTS_PER_STREAM newest)
  const streamIndex = eventsStore.index("streamId")
  const allStreams = new Set<string>()

  // First, collect all unique stream IDs
  const collectTx = db.transaction(STORES.events, "readonly")
  const collectStore = collectTx.objectStore(STORES.events)
  const collectIndex = collectStore.index("streamId")

  await new Promise<void>((resolve, reject) => {
    const request = collectIndex.openCursor(null, "nextunique")
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        allStreams.add(cursor.key as string)
        cursor.continue()
      }
    }
    collectTx.oncomplete = () => resolve()
    collectTx.onerror = () => reject(collectTx.error)
  })

  // For each stream, check if we need to prune
  for (const streamId of allStreams) {
    const events = await getCachedEvents(streamId)
    if (events.length > MAX_EVENTS_PER_STREAM) {
      const toDelete = events.slice(0, events.length - MAX_EVENTS_PER_STREAM)
      const deleteTx = db.transaction(STORES.events, "readwrite")
      const deleteStore = deleteTx.objectStore(STORES.events)

      for (const event of toDelete) {
        deleteStore.delete(event.id)
        eventsDeleted++
      }

      await new Promise<void>((resolve, reject) => {
        deleteTx.oncomplete = () => resolve()
        deleteTx.onerror = () => reject(deleteTx.error)
      })
    }
  }

  // Prune old streams
  const streamsTx = db.transaction(STORES.streams, "readwrite")
  const streamsStore = streamsTx.objectStore(STORES.streams)
  const streamsCachedAtIndex = streamsStore.index("cachedAt")

  await new Promise<void>((resolve, reject) => {
    const range = IDBKeyRange.upperBound(cutoff)
    const request = streamsCachedAtIndex.openCursor(range)

    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        cursor.delete()
        streamsDeleted++
        cursor.continue()
      }
    }

    streamsTx.oncomplete = () => resolve()
    streamsTx.onerror = () => reject(streamsTx.error)
  })

    return { eventsDeleted, streamsDeleted }
  } catch (err) {
    console.warn("[DB] Cache pruning failed, will retry later:", err)
    // Reset connection on error so next operation will reconnect
    dbInstance = null
    dbPromise = null
    return { eventsDeleted: 0, streamsDeleted: 0 }
  }
}

// ==========================================================================
// Utility: Check if IndexedDB is available
// ==========================================================================

export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null
  } catch {
    return false
  }
}
