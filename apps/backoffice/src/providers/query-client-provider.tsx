import {
  QueryClient,
  QueryClientProvider as TanStackQueryClientProvider,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query"
import { useState, type ReactNode } from "react"
import { ApiError, API_BASE } from "@/api/client"

const AUTH_REDIRECT_KEY = "auth_redirect_count"
const AUTH_REDIRECT_TIMESTAMP_KEY = "auth_redirect_ts"
const MAX_REDIRECTS = 3
const REDIRECT_WINDOW_MS = 30_000

/**
 * Global error interceptor. Redirects to WorkOS login when a 401 bubbles up
 * from any query/mutation. Loop protection matches the main frontend: if the
 * browser bounces through login more than MAX_REDIRECTS times in a
 * REDIRECT_WINDOW_MS window we stop redirecting and log instead.
 */
function handleGlobalError(error: Error) {
  if (!ApiError.isApiError(error) || error.status !== 401) return

  const now = Date.now()
  const lastTs = parseInt(sessionStorage.getItem(AUTH_REDIRECT_TIMESTAMP_KEY) ?? "0", 10)
  const count = parseInt(sessionStorage.getItem(AUTH_REDIRECT_KEY) ?? "0", 10)
  const currentCount = now - lastTs > REDIRECT_WINDOW_MS ? 0 : count

  if (currentCount >= MAX_REDIRECTS) {
    console.error("Backoffice auth redirect loop detected. Clear cookies and try again.")
    return
  }

  sessionStorage.setItem(AUTH_REDIRECT_KEY, String(currentCount + 1))
  sessionStorage.setItem(AUTH_REDIRECT_TIMESTAMP_KEY, String(now))

  const currentPath = window.location.pathname + window.location.search
  window.location.href = `${API_BASE}/api/auth/login?redirect_to=${encodeURIComponent(currentPath)}`
}

function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleGlobalError }),
    mutationCache: new MutationCache({ onError: handleGlobalError }),
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        refetchOnWindowFocus: true,
        retry: false,
      },
    },
  })
}

interface Props {
  children: ReactNode
}

export function QueryClientProvider({ children }: Props) {
  const [queryClient] = useState(makeQueryClient)
  return <TanStackQueryClientProvider client={queryClient}>{children}</TanStackQueryClientProvider>
}
