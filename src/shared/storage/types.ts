/**
 * Platform-Agnostic Storage Interface
 *
 * This interface abstracts storage operations so business logic
 * can work across Web (IndexedDB), React Native (MMKV/AsyncStorage),
 * and Electron (SQLite/electron-store).
 */

import type { Persister, PersistedClient } from "@tanstack/query-persist-client-core"

/**
 * Simple async key-value storage interface.
 * Used by TanStack Query persister for caching query state.
 */
export interface AsyncStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

// Re-export TanStack Query types
export type { Persister, PersistedClient }

/**
 * Creates a TanStack Query persister from an AsyncStorage implementation.
 * This allows the same query persistence logic to work across platforms.
 */
export function createPersister(storage: AsyncStorage, key = "threa-query-cache"): Persister {
  return {
    async persistClient(client: PersistedClient) {
      await storage.setItem(key, JSON.stringify(client))
    },
    async restoreClient() {
      const data = await storage.getItem(key)
      if (!data) return undefined
      try {
        return JSON.parse(data) as PersistedClient
      } catch {
        return undefined
      }
    },
    async removeClient() {
      await storage.removeItem(key)
    },
  }
}
