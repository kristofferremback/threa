/**
 * TanStack Query Client Configuration
 *
 * Sets up the QueryClient with offline-first configuration and persistence.
 */

import { QueryClient } from "@tanstack/react-query"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { indexedDBStorage, createPersister } from "../../shared/storage"

// Default configuration for offline-first behavior
const DEFAULT_STALE_TIME = 5 * 60 * 1000 // 5 minutes
const DEFAULT_GC_TIME = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Create the QueryClient with offline-first defaults
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data is considered fresh for 5 minutes
        staleTime: DEFAULT_STALE_TIME,
        // Keep cached data for 24 hours (for persistence)
        gcTime: DEFAULT_GC_TIME,
        // Return cached data immediately, refetch in background
        networkMode: "offlineFirst",
        // Refetch when window regains focus
        refetchOnWindowFocus: true,
        // Refetch when network reconnects
        refetchOnReconnect: true,
        // Don't retry failed queries by default (we'll handle this per-query)
        retry: false,
      },
      mutations: {
        // Allow mutations to be queued when offline
        networkMode: "offlineFirst",
        // Retry mutations up to 3 times
        retry: 3,
      },
    },
  })
}

/**
 * Create the persister for caching query state to IndexedDB
 */
export function createQueryPersister() {
  return createPersister(indexedDBStorage, "threa-query-cache")
}

// Singleton QueryClient instance
let queryClient: QueryClient | null = null

export function getQueryClient(): QueryClient {
  if (!queryClient) {
    queryClient = createQueryClient()
  }
  return queryClient
}

// Re-export for convenience
export { PersistQueryClientProvider }
