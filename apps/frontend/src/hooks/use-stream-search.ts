import { useState, useCallback, useRef } from "react"
import { searchMessages, type SearchFilters, type SearchResultItem } from "@/api"
import { db } from "@/db"

interface UseStreamSearchOptions {
  workspaceId: string
  streamId: string
}

interface UseStreamSearchReturn {
  query: string
  setQuery: (query: string) => void
  results: SearchResultItem[]
  isSearching: boolean
  /** Whether at least one search has completed for the current query */
  hasSearched: boolean
  error: Error | null
  /** Index of the currently focused result (0-based) */
  activeIndex: number
  /** Total result count */
  resultCount: number
  /** Execute search with current query */
  search: () => Promise<void>
  /** Move to next (newer) result */
  nextResult: () => void
  /** Move to previous (older) result */
  prevResult: () => void
  /** Reset search state */
  clear: () => void
  /** The currently active result (if any) */
  activeResult: SearchResultItem | null
  /** Re-focus the search input (for Cmd+F when already open) */
  focus: () => void
  /** Ref to attach to the search input for programmatic focus */
  inputRef: React.RefObject<HTMLInputElement | null>
}

/** Search local IDB events for a text match (case-insensitive substring) */
async function searchLocalEvents(streamId: string, query: string): Promise<SearchResultItem[]> {
  const lowerQuery = query.toLowerCase()
  const events = await db.events
    .where("streamId")
    .equals(streamId)
    .filter((e) => {
      if (e.eventType !== "message_created") return false
      const payload = e.payload as { contentMarkdown?: string }
      return !!payload.contentMarkdown && payload.contentMarkdown.toLowerCase().includes(lowerQuery)
    })
    .toArray()

  return events
    .sort((a, b) => a._sequenceNum - b._sequenceNum)
    .map((e) => {
      const payload = e.payload as { messageId?: string; contentMarkdown?: string }
      return {
        id: payload.messageId ?? e.id,
        streamId: e.streamId,
        content: payload.contentMarkdown ?? "",
        authorId: e.actorId ?? "",
        authorType: (e.actorType ?? "user") as "user" | "persona",
        createdAt: e.createdAt,
        rank: 0,
      }
    })
}

/** Merge local and server results, dedup by id, sort chronologically (oldest first) */
function mergeAndSort(local: SearchResultItem[], server: SearchResultItem[]): SearchResultItem[] {
  const seen = new Map<string, SearchResultItem>()
  // Server results take precedence (richer data)
  for (const r of local) seen.set(r.id, r)
  for (const r of server) seen.set(r.id, r)
  return Array.from(seen.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export function useStreamSearch({ workspaceId, streamId }: UseStreamSearchOptions): UseStreamSearchReturn {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [hasSearched, setHasSearched] = useState(false)
  const searchIdRef = useRef(0)
  const queryRef = useRef(query)
  queryRef.current = query
  const inputRef = useRef<HTMLInputElement>(null)

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
      // Phase 1: instant local IDB search
      const localResults = await searchLocalEvents(streamId, trimmed)
      if (searchId !== searchIdRef.current) return

      if (localResults.length > 0) {
        setResults(localResults)
        // Start at the most recent match (bottom of conversation)
        setActiveIndex(localResults.length - 1)
        setHasSearched(true)
      }

      // Phase 2: server search (richer results, covers events not in IDB)
      const filters: SearchFilters = { in: [streamId] }
      const response = await searchMessages(workspaceId, { query: trimmed, filters, limit: 50 })
      if (searchId !== searchIdRef.current) return

      const merged = mergeAndSort(localResults, response.results)
      setResults(merged)
      // If this is the first result set (no local hits), start at most recent
      if (localResults.length === 0) {
        setActiveIndex(merged.length > 0 ? merged.length - 1 : -1)
      }
      setHasSearched(true)
    } catch (e) {
      if (searchId !== searchIdRef.current) return
      setError(e instanceof Error ? e : new Error("Search failed"))
      // Keep local results if server fails
      if (results.length === 0) {
        setResults([])
        setActiveIndex(-1)
      }
    } finally {
      if (searchId === searchIdRef.current) {
        setIsSearching(false)
      }
    }
  }, [workspaceId, streamId])

  // Navigate up = older (lower index in chronological array)
  const prevResult = useCallback(() => {
    if (results.length === 0) return
    setActiveIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1))
  }, [results.length])

  // Navigate down = newer (higher index in chronological array)
  const nextResult = useCallback(() => {
    if (results.length === 0) return
    setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0))
  }, [results.length])

  const clear = useCallback(() => {
    setQuery("")
    setResults([])
    setActiveIndex(0)
    setError(null)
    setIsSearching(false)
    setHasSearched(false)
    searchIdRef.current++
  }, [])

  const focus = useCallback(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const activeResult = results.length > 0 && activeIndex >= 0 ? (results[activeIndex] ?? null) : null

  return {
    query,
    setQuery,
    results,
    isSearching,
    error,
    activeIndex,
    hasSearched,
    resultCount: results.length,
    search,
    nextResult,
    prevResult,
    clear,
    activeResult,
    focus,
    inputRef,
  }
}
