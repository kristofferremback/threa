import { QueryClient, QueryClientProvider as TanStackQueryClientProvider } from "@tanstack/react-query"
import { ReactNode, useState } from "react"

function makeQueryClient() {
  return new QueryClient({
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
