import { useState, useCallback, useRef } from "react"
import { searchMessages, type SearchFilters, type SearchResultItem } from "@/api"

interface UseStreamSearchOptions {
  workspaceId: string
  streamId: string
}

interface UseStreamSearchReturn {
  query: string
  setQuery: (query: string) => void
  results: SearchResultItem[]
  isSearching: boolean
  error: Error | null
  /** Index of the currently focused result (0-based) */
  activeIndex: number
  /** Total result count */
  resultCount: number
  /** Execute search with current query */
  search: () => Promise<void>
  /** Move to next result */
  nextResult: () => void
  /** Move to previous result */
  prevResult: () => void
  /** Reset search state */
  clear: () => void
  /** The currently active result (if any) */
  activeResult: SearchResultItem | null
}

export function useStreamSearch({ workspaceId, streamId }: UseStreamSearchOptions): UseStreamSearchReturn {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // Dedup concurrent searches — only the latest one wins
  const searchIdRef = useRef(0)
  // Ref so search() always reads the latest query without needing it as a dep
  const queryRef = useRef(query)
  queryRef.current = query

  const search = useCallback(async () => {
    const trimmed = queryRef.current.trim()
    if (!trimmed) {
      setResults([])
      setActiveIndex(0)
      return
    }

    const searchId = ++searchIdRef.current
    setIsSearching(true)
    setError(null)

    try {
      const filters: SearchFilters = { in: [streamId] }
      const response = await searchMessages(workspaceId, { query: trimmed, filters, limit: 50 })

      // Only apply if this is still the latest search
      if (searchId !== searchIdRef.current) return

      setResults(response.results)
      setActiveIndex(response.results.length > 0 ? 0 : -1)
    } catch (e) {
      if (searchId !== searchIdRef.current) return
      setError(e instanceof Error ? e : new Error("Search failed"))
      setResults([])
      setActiveIndex(-1)
    } finally {
      if (searchId === searchIdRef.current) {
        setIsSearching(false)
      }
    }
  }, [workspaceId, streamId])

  const nextResult = useCallback(() => {
    if (results.length === 0) return
    setActiveIndex((prev) => (prev + 1) % results.length)
  }, [results.length])

  const prevResult = useCallback(() => {
    if (results.length === 0) return
    setActiveIndex((prev) => (prev - 1 + results.length) % results.length)
  }, [results.length])

  const clear = useCallback(() => {
    setQuery("")
    setResults([])
    setActiveIndex(0)
    setError(null)
    setIsSearching(false)
    searchIdRef.current++
  }, [])

  const activeResult = results.length > 0 && activeIndex >= 0 ? (results[activeIndex] ?? null) : null

  return {
    query,
    setQuery,
    results,
    isSearching,
    error,
    activeIndex,
    resultCount: results.length,
    search,
    nextResult,
    prevResult,
    clear,
    activeResult,
  }
}
