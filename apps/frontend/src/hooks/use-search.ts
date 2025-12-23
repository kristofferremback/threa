import { useState, useCallback } from "react"
import { searchMessages, type SearchFilters, type SearchResultItem } from "@/api"

interface UseSearchOptions {
  workspaceId: string
}

interface UseSearchReturn {
  results: SearchResultItem[]
  isLoading: boolean
  error: Error | null
  search: (query: string, filters?: SearchFilters) => Promise<void>
  clear: () => void
}

export function useSearch({ workspaceId }: UseSearchOptions): UseSearchReturn {
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const search = useCallback(
    async (query: string, filters?: SearchFilters) => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await searchMessages(workspaceId, { query, filters })
        setResults(response.results)
      } catch (e) {
        setError(e instanceof Error ? e : new Error("Search failed"))
        setResults([])
      } finally {
        setIsLoading(false)
      }
    },
    [workspaceId]
  )

  const clear = useCallback(() => {
    setResults([])
    setError(null)
  }, [])

  return { results, isLoading, error, search, clear }
}
