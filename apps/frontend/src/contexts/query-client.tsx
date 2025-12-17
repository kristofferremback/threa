import { QueryClient, QueryClientProvider as TanStackQueryClientProvider } from "@tanstack/react-query"
import { ReactNode, useState } from "react"

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data is considered fresh for 30 seconds
        staleTime: 30 * 1000,
        // Refetch on window focus for fresh data
        refetchOnWindowFocus: true,
        // Don't retry on error by default (we handle errors explicitly)
        retry: false,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined = undefined

function getQueryClient() {
  // Server: always make a new query client
  if (typeof window === "undefined") {
    return makeQueryClient()
  }
  // Browser: make a new query client if we don't already have one
  // This helps ensure we don't re-create the client during hydration
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient()
  }
  return browserQueryClient
}

interface QueryClientProviderProps {
  children: ReactNode
}

export function QueryClientProvider({ children }: QueryClientProviderProps) {
  const [queryClient] = useState(getQueryClient)

  return (
    <TanStackQueryClientProvider client={queryClient}>
      {children}
    </TanStackQueryClientProvider>
  )
}

// Export for direct access when needed (e.g., invalidating queries from socket handlers)
export { getQueryClient }
