import {
  QueryClient,
  QueryClientProvider as TanStackQueryClientProvider,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query"
import { ReactNode, useState } from "react"
import { ApiError } from "@/api/client"

function handleGlobalError(error: Error) {
  if (ApiError.isApiError(error) && error.status === 401) {
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
