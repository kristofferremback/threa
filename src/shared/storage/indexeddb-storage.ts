/**
 * IndexedDB-based AsyncStorage Implementation (Web)
 *
 * Wraps IndexedDB with the simple AsyncStorage interface
 * for use with TanStack Query persistence.
 */

import type { AsyncStorage } from "./types"

const DB_NAME = "threa-query-cache"
const DB_VERSION = 1
const STORE_NAME = "cache"

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      dbPromise = null
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`))
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
  })

  return dbPromise
}

/**
 * IndexedDB-based AsyncStorage for TanStack Query persistence.
 */
export const indexedDBStorage: AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly")
        const store = tx.objectStore(STORE_NAME)
        const request = store.get(key)

        request.onsuccess = () => resolve(request.result ?? null)
        request.onerror = () => reject(request.error)
      })
    } catch {
      return null
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite")
        const store = tx.objectStore(STORE_NAME)
        const request = store.put(value, key)

        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch {
      // Silently fail - caching is best-effort
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite")
        const store = tx.objectStore(STORE_NAME)
        const request = store.delete(key)

        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch {
      // Silently fail
    }
  },
}
