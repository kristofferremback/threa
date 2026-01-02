import {
  QueryClient,
  QueryClientProvider as TanStackQueryClientProvider,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query"
import { ReactNode, useState } from "react"
import { ApiError } from "@/api/client"

const AUTH_REDIRECT_KEY = "auth_redirect_count"
const AUTH_REDIRECT_TIMESTAMP_KEY = "auth_redirect_ts"
const MAX_REDIRECTS = 3
const REDIRECT_WINDOW_MS = 30_000 // 30 seconds

function handleGlobalError(error: Error) {
  if (ApiError.isApiError(error) && error.status === 401) {
    // Prevent redirect loops: track redirects within a time window
    const now = Date.now()
    const lastTs = parseInt(sessionStorage.getItem(AUTH_REDIRECT_TIMESTAMP_KEY) ?? "0", 10)
    const count = parseInt(sessionStorage.getItem(AUTH_REDIRECT_KEY) ?? "0", 10)

    // Reset counter if outside the window
    const currentCount = now - lastTs > REDIRECT_WINDOW_MS ? 0 : count

    if (currentCount >= MAX_REDIRECTS) {
      console.error("Auth redirect loop detected. Please clear cookies and try again.")
      return
    }

    // Update counter and timestamp
    sessionStorage.setItem(AUTH_REDIRECT_KEY, String(currentCount + 1))
    sessionStorage.setItem(AUTH_REDIRECT_TIMESTAMP_KEY, String(now))

    const currentPath = window.location.pathname + window.location.search
    window.location.href = `/api/auth/login?redirect_to=${encodeURIComponent(currentPath)}`
  }
}

function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: handleGlobalError,
    }),
    mutationCache: new MutationCache({
      onError: handleGlobalError,
    }),
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        refetchOnWindowFocus: true,
        retry: false,
      },
    },
  })
}

let queryClientSingleton: QueryClient | undefined = undefined

export function getQueryClient() {
  if (!queryClientSingleton) {
    queryClientSingleton = makeQueryClient()
  }
  return queryClientSingleton
}

interface QueryClientProviderProps {
  children: ReactNode
}

export function QueryClientProvider({ children }: QueryClientProviderProps) {
  const [queryClient] = useState(getQueryClient)

  return <TanStackQueryClientProvider client={queryClient}>{children}</TanStackQueryClientProvider>
}
