/**
 * Query Context Provider
 *
 * Wraps the app with TanStack Query context, including offline persistence.
 */

import { type ReactNode } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import type { Persister } from "@tanstack/query-persist-client-core"
import { getQueryClient, createQueryPersister } from "../lib/query-client"

interface QueryProviderProps {
  children: ReactNode
}

// Create persister lazily to avoid SSR issues
let persister: Persister | null = null

function getPersister(): Persister | null {
  if (!persister && typeof window !== "undefined") {
    persister = createQueryPersister()
  }
  return persister
}

/**
 * QueryProvider with offline persistence
 *
 * Wraps children with TanStack Query context and persists
 * query cache to IndexedDB for offline support.
 */
export function QueryProvider({ children }: QueryProviderProps) {
  const queryClient = getQueryClient()
  const queryPersister = getPersister()

  // If we have a persister (browser environment), use PersistQueryClientProvider
  if (queryPersister) {
    return (
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          // Max age for persisted data (24 hours)
          maxAge: 24 * 60 * 60 * 1000,
          // Unique key for this app's cache
          buster: "v1",
        }}
      >
        {children}
      </PersistQueryClientProvider>
    )
  }

  // Fallback for SSR or environments without IndexedDB
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

// Export the hook to access query client outside React
export { getQueryClient }
