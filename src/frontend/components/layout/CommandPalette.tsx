import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import {
  Hash,
  Lock,
  Search,
  X,
  UserCheck,
  UserPlus,
  PanelRightOpen,
  MessageSquare,
  FileText,
  User,
  AtSign,
  Users,
  WifiOff,
} from "lucide-react"
import type { Stream, OpenMode } from "../../types"
import { getOpenMode } from "../../types"
import { Avatar } from "../ui"
import { useOffline } from "../../contexts/OfflineContext"

type PaletteMode = "navigate" | "search"

/** Stream type filter options */
type StreamTypeFilter = "channel" | "thread" | "thinking_space"

const STREAM_TYPE_OPTIONS: Array<{ type: StreamTypeFilter; label: string; description: string }> = [
  { type: "channel", label: "Channels", description: "Public & private channels" },
  { type: "thread", label: "Threads", description: "Thread replies" },
  { type: "thinking_space", label: "Thinking Spaces", description: "Private AI conversations" },
]

/** Active search filters with resolved IDs */
interface SearchFilters {
  /** Messages FROM these users */
  users: Array<{ id: string; name: string }>
  /** Messages in conversations WITH these users (they participated) */
  withUsers: Array<{ id: string; name: string }>
  /** Messages in these channels */
  channels: Array<{ id: string; name: string; slug: string }>
  /** Stream type filters */
  streamTypes: StreamTypeFilter[]
}

/** Autocomplete state for filter selection */
type FilterAutocomplete =
  | { type: "none" }
  | { type: "user"; query: string }
  | { type: "withUser"; query: string }
  | { type: "channel"; query: string }
  | { type: "streamType"; query: string }

interface CommandPaletteProps {
  open: boolean
  mode?: PaletteMode
  onClose: () => void
  streams: Stream[]
  workspaceId: string
  users?: Array<{ id: string; name: string; email: string }>
  onSelectStream: (stream: Stream, mode: OpenMode) => void
  onNavigateToMessage?: (streamSlugOrId: string, eventId: string, mode: OpenMode) => void
}

interface ScoredStream {
  stream: Stream
  score: number
  matchType: "exact" | "startsWith" | "contains" | "fuzzy"
  matchedField: "name" | "slug" | "topic" | "description"
}

interface SearchResult {
  type: "message" | "knowledge"
  id: string
  streamId?: string
  streamSlug?: string
  streamName?: string
  content: string
  score: number
  highlights?: string
  createdAt: string
  actor?: {
    id: string
    name: string
    email: string
  }
}

// Fuzzy matching score calculator
function calculateFuzzyScore(query: string, text: string): { score: number; matchType: ScoredStream["matchType"] } {
  const lowerQuery = query.toLowerCase()
  const lowerText = text.toLowerCase()

  if (lowerText === lowerQuery) {
    return { score: 100, matchType: "exact" }
  }

  if (lowerText.startsWith(lowerQuery)) {
    return { score: 90 - (lowerText.length - lowerQuery.length) * 0.5, matchType: "startsWith" }
  }

  const containsIndex = lowerText.indexOf(lowerQuery)
  if (containsIndex !== -1) {
    const positionPenalty = containsIndex * 0.5
    return { score: 70 - positionPenalty, matchType: "contains" }
  }

  let queryIndex = 0
  let matchedChars = 0
  let consecutiveBonus = 0
  let lastMatchIndex = -2

  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      matchedChars++
      if (i === lastMatchIndex + 1) {
        consecutiveBonus += 5
      }
      lastMatchIndex = i
      queryIndex++
    }
  }

  if (queryIndex === lowerQuery.length) {
    const baseScore = 30 + (matchedChars / lowerText.length) * 20 + consecutiveBonus
    return { score: Math.min(baseScore, 60), matchType: "fuzzy" }
  }

  return { score: 0, matchType: "fuzzy" }
}

function scoreStream(stream: Stream, query: string): ScoredStream | null {
  if (!query.trim()) {
    return {
      stream,
      score: stream.isMember ? 100 : 50,
      matchType: "exact",
      matchedField: "name",
    }
  }

  const fieldsToSearch: Array<{ field: ScoredStream["matchedField"]; text: string | null; weight: number }> = [
    { field: "name", text: (stream.name || "").replace("#", ""), weight: 1.0 },
    { field: "slug", text: stream.slug, weight: 0.9 },
    { field: "topic", text: stream.topic, weight: 0.6 },
    { field: "description", text: stream.description, weight: 0.5 },
  ]

  let bestScore = 0
  let bestMatchType: ScoredStream["matchType"] = "fuzzy"
  let bestMatchedField: ScoredStream["matchedField"] = "name"

  for (const { field, text, weight } of fieldsToSearch) {
    if (!text) continue

    const { score, matchType } = calculateFuzzyScore(query, text)
    const weightedScore = score * weight

    if (weightedScore > bestScore) {
      bestScore = weightedScore
      bestMatchType = matchType
      bestMatchedField = field
    }
  }

  if (bestScore === 0) {
    return null
  }

  const membershipMultiplier = stream.isMember ? 1.5 : 1.0
  const finalScore = bestScore * membershipMultiplier

  return {
    stream,
    score: finalScore,
    matchType: bestMatchType,
    matchedField: bestMatchedField,
  }
}

// Fuzzy match helper (shared with mention-suggestion)
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t.includes(q)) return true
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

export function CommandPalette({
  open,
  mode: initialMode = "navigate",
  onClose,
  streams,
  workspaceId,
  users = [],
  onSelectStream,
  onNavigateToMessage,
}: CommandPaletteProps) {
  const { isOnline } = useOffline()
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<PaletteMode>(initialMode)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({
    users: [],
    withUsers: [],
    channels: [],
    streamTypes: [],
  })
  const [filterAutocomplete, setFilterAutocomplete] = useState<FilterAutocomplete>({ type: "none" })
  const [autocompleteIndex, setAutocompleteIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Detect filter triggers in query (from:@, with:@, in:#, or is:)
  const detectFilterTrigger = useCallback((text: string): FilterAutocomplete => {
    // Check for from:@ trigger
    const fromMatch = text.match(/from:@([^\s]*)$/)
    if (fromMatch?.[1] !== undefined) {
      return { type: "user", query: fromMatch[1] }
    }
    // Check for with:@ trigger
    const withMatch = text.match(/with:@([^\s]*)$/)
    if (withMatch?.[1] !== undefined) {
      return { type: "withUser", query: withMatch[1] }
    }
    // Check for in:# trigger
    const inMatch = text.match(/in:#([^\s]*)$/)
    if (inMatch?.[1] !== undefined) {
      return { type: "channel", query: inMatch[1] }
    }
    // Check for is: trigger (stream type filter)
    const isMatch = text.match(/is:([^\s]*)$/)
    if (isMatch?.[1] !== undefined) {
      return { type: "streamType", query: isMatch[1] }
    }
    return { type: "none" }
  }, [])

  // Get autocomplete suggestions based on filter type
  const autocompleteSuggestions = useMemo(() => {
    if (filterAutocomplete.type === "none") return []

    if (filterAutocomplete.type === "user") {
      const q = filterAutocomplete.query.toLowerCase()
      return users
        .filter((u) => {
          // Don't show already selected users
          if (searchFilters.users.some((f) => f.id === u.id)) return false
          if (!q) return true
          return fuzzyMatch(q, u.name) || fuzzyMatch(q, u.email)
        })
        .slice(0, 6)
    }

    if (filterAutocomplete.type === "withUser") {
      const q = filterAutocomplete.query.toLowerCase()
      return users
        .filter((u) => {
          // Don't show already selected "with" users
          if (searchFilters.withUsers.some((f) => f.id === u.id)) return false
          if (!q) return true
          return fuzzyMatch(q, u.name) || fuzzyMatch(q, u.email)
        })
        .slice(0, 6)
    }

    if (filterAutocomplete.type === "channel") {
      const q = filterAutocomplete.query.toLowerCase()
      return streams
        .filter((s) => {
          if (s.streamType !== "channel") return false
          if (!s.slug) return false
          // Don't show already selected channels
          if (searchFilters.channels.some((f) => f.id === s.id)) return false
          if (!q) return true
          return fuzzyMatch(q, s.name || "") || fuzzyMatch(q, s.slug || "")
        })
        .slice(0, 6)
    }

    if (filterAutocomplete.type === "streamType") {
      const q = filterAutocomplete.query.toLowerCase()
      return STREAM_TYPE_OPTIONS.filter((opt) => {
        // Don't show already selected stream types
        if (searchFilters.streamTypes.includes(opt.type)) return false
        if (!q) return true
        return fuzzyMatch(q, opt.label) || fuzzyMatch(q, opt.type) || fuzzyMatch(q, opt.description)
      })
    }

    return []
  }, [filterAutocomplete, users, streams, searchFilters])

  // Handle query changes - detect filter triggers
  const handleQueryChange = useCallback(
    (newQuery: string) => {
      setQuery(newQuery)
      setSelectedIndex(0)

      if (mode === "search") {
        const trigger = detectFilterTrigger(newQuery)
        setFilterAutocomplete(trigger)
        setAutocompleteIndex(0)
      }
    },
    [mode, detectFilterTrigger],
  )

  // Select an autocomplete item
  const selectAutocompleteItem = useCallback(
    (index: number) => {
      const item = autocompleteSuggestions[index]
      if (!item) return

      if (filterAutocomplete.type === "user" && "email" in item) {
        // Add user filter (from:)
        setSearchFilters((prev) => ({
          ...prev,
          users: [...prev.users, { id: item.id, name: item.name }],
        }))
        // Remove the from:@query part from the query
        setQuery((prev) => prev.replace(/from:@[^\s]*$/, "").trim())
      } else if (filterAutocomplete.type === "withUser" && "email" in item) {
        // Add "with" user filter
        setSearchFilters((prev) => ({
          ...prev,
          withUsers: [...prev.withUsers, { id: item.id, name: item.name }],
        }))
        // Remove the with:@query part from the query
        setQuery((prev) => prev.replace(/with:@[^\s]*$/, "").trim())
      } else if (filterAutocomplete.type === "channel" && "slug" in item) {
        // Add channel filter
        setSearchFilters((prev) => ({
          ...prev,
          channels: [...prev.channels, { id: item.id, name: item.name || "", slug: item.slug || "" }],
        }))
        // Remove the in:#query part from the query
        setQuery((prev) => prev.replace(/in:#[^\s]*$/, "").trim())
      } else if (filterAutocomplete.type === "streamType" && "type" in item) {
        // Add stream type filter
        setSearchFilters((prev) => ({
          ...prev,
          streamTypes: [...prev.streamTypes, item.type as StreamTypeFilter],
        }))
        // Remove the is:query part from the query
        setQuery((prev) => prev.replace(/is:[^\s]*$/, "").trim())
      }

      setFilterAutocomplete({ type: "none" })
      setAutocompleteIndex(0)
      inputRef.current?.focus()
    },
    [autocompleteSuggestions, filterAutocomplete.type],
  )

  // Remove a filter
  const removeFilter = useCallback((type: "user" | "withUser" | "channel" | "streamType", id: string) => {
    setSearchFilters((prev) => ({
      ...prev,
      users: type === "user" ? prev.users.filter((u) => u.id !== id) : prev.users,
      withUsers: type === "withUser" ? prev.withUsers.filter((u) => u.id !== id) : prev.withUsers,
      channels: type === "channel" ? prev.channels.filter((c) => c.id !== id) : prev.channels,
      streamTypes: type === "streamType" ? prev.streamTypes.filter((t) => t !== id) : prev.streamTypes,
    }))
  }, [])

  // Filter streams for navigate mode
  const scoredStreams = useMemo(() => {
    if (mode !== "navigate") return []

    const results: ScoredStream[] = []
    for (const stream of streams) {
      if (stream.streamType !== "channel") continue
      const scored = scoreStream(stream, query)
      if (scored) {
        results.push(scored)
      }
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return (a.stream.name || "").localeCompare(b.stream.name || "")
    })

    return results
  }, [streams, query, mode])

  // Debounced search for search mode
  useEffect(() => {
    // Don't search if autocomplete is open
    if (filterAutocomplete.type !== "none") {
      return
    }

    // Need either query text or filters to search
    const hasFilters =
      searchFilters.users.length > 0 ||
      searchFilters.withUsers.length > 0 ||
      searchFilters.channels.length > 0 ||
      searchFilters.streamTypes.length > 0
    if (mode !== "search" || (!query.trim() && !hasFilters)) {
      setSearchResults([])
      setSearchError(null)
      return
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    setIsSearching(true)
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        // Use POST endpoint with typed filters
        const res = await fetch(`/api/workspace/${workspaceId}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            query: query.trim(),
            filters: {
              userIds: searchFilters.users.length > 0 ? searchFilters.users.map((u) => u.id) : undefined,
              withUserIds: searchFilters.withUsers.length > 0 ? searchFilters.withUsers.map((u) => u.id) : undefined,
              streamIds: searchFilters.channels.length > 0 ? searchFilters.channels.map((c) => c.id) : undefined,
              streamTypes: searchFilters.streamTypes.length > 0 ? searchFilters.streamTypes : undefined,
            },
            limit: 20,
            type: "messages",
          }),
        })

        if (!res.ok) {
          throw new Error("Search failed")
        }

        const data = await res.json()
        setSearchResults(data.results || [])
        setSearchError(null)
      } catch (err) {
        console.error("Search error:", err)
        setSearchError("Failed to search")
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [query, mode, workspaceId, searchFilters, filterAutocomplete.type])

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("")
      setSelectedIndex(0)
      setMode(initialMode)
      setSearchResults([])
      setSearchError(null)
      setSearchFilters({ users: [], withUsers: [], channels: [], streamTypes: [] })
      setFilterAutocomplete({ type: "none" })
      setAutocompleteIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, initialMode])

  // Get current items based on mode
  const currentItems = mode === "navigate" ? scoredStreams : searchResults
  const itemCount = currentItems.length

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= itemCount) {
      setSelectedIndex(Math.max(0, itemCount - 1))
    }
  }, [itemCount, selectedIndex])

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = listRef.current?.children[selectedIndex] as HTMLElement
    selectedElement?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Handle autocomplete navigation first
      if (filterAutocomplete.type !== "none" && autocompleteSuggestions.length > 0) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault()
            setAutocompleteIndex((prev) => Math.min(prev + 1, autocompleteSuggestions.length - 1))
            return
          case "ArrowUp":
            e.preventDefault()
            setAutocompleteIndex((prev) => Math.max(prev - 1, 0))
            return
          case "Enter":
          case "Tab":
            e.preventDefault()
            selectAutocompleteItem(autocompleteIndex)
            return
          case "Escape":
            e.preventDefault()
            setFilterAutocomplete({ type: "none" })
            return
        }
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, itemCount - 1))
          break
        case "ArrowUp":
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case "Tab":
          // Toggle between modes
          e.preventDefault()
          setMode((prev) => (prev === "navigate" ? "search" : "navigate"))
          setSelectedIndex(0)
          setSearchFilters({ users: [], withUsers: [], channels: [], streamTypes: [] })
          break
        case "Enter":
          e.preventDefault()
          if (mode === "navigate" && scoredStreams[selectedIndex]) {
            let openMode: OpenMode = "replace"
            if (e.metaKey || e.ctrlKey) openMode = "newTab"
            else if (e.altKey) openMode = "side"
            onSelectStream(scoredStreams[selectedIndex].stream, openMode)
            onClose()
          } else if (mode === "search" && searchResults[selectedIndex]) {
            const result = searchResults[selectedIndex]
            const streamSlugOrId = result.streamSlug || result.streamId
            if (streamSlugOrId && onNavigateToMessage) {
              let openMode: OpenMode = "replace"
              if (e.metaKey || e.ctrlKey) openMode = "newTab"
              else if (e.altKey) openMode = "side"
              onNavigateToMessage(streamSlugOrId, result.id, openMode)
              onClose()
            }
          }
          break
        case "Escape":
          e.preventDefault()
          onClose()
          break
        case "Backspace":
          // Remove last filter if cursor is at start of empty query
          if (
            !query &&
            (searchFilters.users.length > 0 ||
              searchFilters.withUsers.length > 0 ||
              searchFilters.channels.length > 0 ||
              searchFilters.streamTypes.length > 0)
          ) {
            e.preventDefault()
            // Remove in reverse order of visual appearance: streamTypes, channels, withUsers, users
            if (searchFilters.streamTypes.length > 0) {
              setSearchFilters((prev) => ({
                ...prev,
                streamTypes: prev.streamTypes.slice(0, -1),
              }))
            } else if (searchFilters.channels.length > 0) {
              setSearchFilters((prev) => ({
                ...prev,
                channels: prev.channels.slice(0, -1),
              }))
            } else if (searchFilters.withUsers.length > 0) {
              setSearchFilters((prev) => ({
                ...prev,
                withUsers: prev.withUsers.slice(0, -1),
              }))
            } else if (searchFilters.users.length > 0) {
              setSearchFilters((prev) => ({
                ...prev,
                users: prev.users.slice(0, -1),
              }))
            }
          }
          break
      }
    },
    [
      mode,
      scoredStreams,
      searchResults,
      selectedIndex,
      itemCount,
      onSelectStream,
      onNavigateToMessage,
      onClose,
      filterAutocomplete,
      autocompleteSuggestions,
      autocompleteIndex,
      selectAutocompleteItem,
      query,
      searchFilters,
    ],
  )

  // Highlight matching text
  const highlightMatch = (text: string, matchedField: ScoredStream["matchedField"], field: string) => {
    if (!query || matchedField !== field) {
      return <span>{text}</span>
    }

    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const index = lowerText.indexOf(lowerQuery)

    if (index === -1) {
      return <span>{text}</span>
    }

    return (
      <>
        {text.slice(0, index)}
        <span style={{ background: "var(--accent-primary)", color: "white", borderRadius: "2px", padding: "0 2px" }}>
          {text.slice(index, index + query.length)}
        </span>
        {text.slice(index + query.length)}
      </>
    )
  }

  // Render search result highlights (from API)
  const renderHighlights = (highlights: string) => {
    // API returns highlights with ** markers
    const parts = highlights.split(/\*\*/g)
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <mark
          key={i}
          style={{ background: "var(--accent-primary)", color: "white", borderRadius: "2px", padding: "0 2px" }}
        >
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      ),
    )
  }

  // Format relative time
  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-2xl rounded-xl overflow-hidden animate-fade-in shadow-2xl"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Mode tabs */}
        <div className="flex" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <button
            onClick={() => {
              setMode("navigate")
              setSelectedIndex(0)
            }}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors"
            style={{
              color: mode === "navigate" ? "var(--text-primary)" : "var(--text-muted)",
              background: mode === "navigate" ? "var(--bg-tertiary)" : "transparent",
              borderBottom: mode === "navigate" ? "2px solid var(--accent-primary)" : "2px solid transparent",
            }}
          >
            <Hash className="h-4 w-4" />
            Channels
          </button>
          <button
            onClick={() => {
              setMode("search")
              setSelectedIndex(0)
            }}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors"
            style={{
              color: mode === "search" ? "var(--text-primary)" : "var(--text-muted)",
              background: mode === "search" ? "var(--bg-tertiary)" : "transparent",
              borderBottom: mode === "search" ? "2px solid var(--accent-primary)" : "2px solid transparent",
            }}
          >
            <Search className="h-4 w-4" />
            Search Messages
          </button>
        </div>

        {/* Search input */}
        <div className="relative">
          <div
            className="flex items-center gap-2 px-4 py-3 flex-wrap"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <Search className="h-5 w-5 flex-shrink-0" style={{ color: "var(--text-muted)" }} />

            {/* Filter chips (only in search mode) */}
            {mode === "search" &&
              searchFilters.users.map((user) => (
                <span
                  key={user.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm"
                  style={{ background: "var(--accent-primary)", color: "white" }}
                >
                  <AtSign className="h-3 w-3" />
                  {user.name}
                  <button
                    onClick={() => removeFilter("user", user.id)}
                    className="ml-0.5 hover:bg-white/20 rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            {mode === "search" &&
              searchFilters.withUsers.map((user) => (
                <span
                  key={`with-${user.id}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm"
                  style={{
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--accent-primary)",
                  }}
                >
                  <Users className="h-3 w-3" style={{ color: "var(--accent-primary)" }} />
                  {user.name}
                  <button
                    onClick={() => removeFilter("withUser", user.id)}
                    className="ml-0.5 hover:bg-white/20 rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            {mode === "search" &&
              searchFilters.channels.map((channel) => (
                <span
                  key={channel.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
                >
                  <Hash className="h-3 w-3" />
                  {channel.name || channel.slug}
                  <button
                    onClick={() => removeFilter("channel", channel.id)}
                    className="ml-0.5 hover:bg-white/20 rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            {mode === "search" &&
              searchFilters.streamTypes.map((streamType) => {
                const opt = STREAM_TYPE_OPTIONS.find((o) => o.type === streamType)
                return (
                  <span
                    key={streamType}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm"
                    style={{
                      background: "var(--bg-tertiary)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    {opt?.label || streamType}
                    <button
                      onClick={() => removeFilter("streamType", streamType)}
                      className="ml-0.5 hover:bg-white/20 rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )
              })}

            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                mode === "navigate"
                  ? "Search channels..."
                  : searchFilters.users.length ||
                      searchFilters.withUsers.length ||
                      searchFilters.channels.length ||
                      searchFilters.streamTypes.length
                    ? "Add search terms..."
                    : "Search messages... (from:@ with:@ in:# is:)"
              }
              className="flex-1 min-w-[150px] bg-transparent outline-none text-base"
              style={{ color: "var(--text-primary)" }}
            />
            {isSearching && (
              <div
                className="h-4 w-4 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: "var(--text-muted)", borderTopColor: "transparent" }}
              />
            )}
            {(query ||
              searchFilters.users.length > 0 ||
              searchFilters.withUsers.length > 0 ||
              searchFilters.channels.length > 0 ||
              searchFilters.streamTypes.length > 0) &&
              !isSearching && (
                <button
                  onClick={() => {
                    setQuery("")
                    setSearchFilters({ users: [], withUsers: [], channels: [], streamTypes: [] })
                    inputRef.current?.focus()
                  }}
                  className="p-1 rounded transition-colors"
                  style={{ color: "var(--text-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
          </div>

          {/* Autocomplete dropdown for filters */}
          {filterAutocomplete.type !== "none" && autocompleteSuggestions.length > 0 && (
            <div
              className="absolute left-4 right-4 top-full mt-1 rounded-lg py-1 shadow-lg overflow-hidden max-h-[200px] overflow-y-auto z-10"
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {autocompleteSuggestions.map((item, index) => (
                <button
                  key={"id" in item ? item.id : "type" in item ? item.type : index}
                  onClick={() => selectAutocompleteItem(index)}
                  onMouseEnter={() => setAutocompleteIndex(index)}
                  className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm transition-colors"
                  style={{
                    background: index === autocompleteIndex ? "var(--hover-overlay)" : "transparent",
                    color: "var(--text-primary)",
                  }}
                >
                  {(filterAutocomplete.type === "user" || filterAutocomplete.type === "withUser") && "email" in item ? (
                    <>
                      <Avatar name={item.name} size="sm" />
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate">{item.name}</span>
                        <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                          {filterAutocomplete.type === "withUser" ? `Conversations with ${item.name}` : item.email}
                        </span>
                      </div>
                    </>
                  ) : filterAutocomplete.type === "channel" && "slug" in item ? (
                    <>
                      <div
                        className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                        style={{ background: "var(--bg-tertiary)" }}
                      >
                        <Hash className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
                      </div>
                      <span className="font-medium truncate">#{item.slug || item.name}</span>
                    </>
                  ) : filterAutocomplete.type === "streamType" && "type" in item ? (
                    <>
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate">{item.label}</span>
                        <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                          {item.description}
                        </span>
                      </div>
                    </>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-96 overflow-y-auto py-2">
          {mode === "navigate" ? (
            // Channel navigation results
            scoredStreams.length === 0 ? (
              <div className="px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>
                {query ? `No channels matching "${query}"` : "No channels available"}
              </div>
            ) : (
              scoredStreams.map((scored, index) => {
                const { stream, matchedField } = scored
                const isPrivate = stream.visibility === "private"
                const Icon = isPrivate ? Lock : Hash
                const isSelected = index === selectedIndex
                const isMember = stream.isMember
                const MemberIcon = isMember ? UserCheck : UserPlus

                return (
                  <button
                    key={stream.id}
                    onClick={(e) => {
                      onSelectStream(stream, getOpenMode(e))
                      onClose()
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors group"
                    style={{ background: isSelected ? "var(--hover-overlay)" : "transparent" }}
                    title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
                  >
                    <Icon
                      className="h-4 w-4 flex-shrink-0"
                      style={{ color: isSelected ? "var(--accent-primary)" : "var(--text-muted)" }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="font-medium truncate"
                          style={{ color: isSelected ? "var(--text-primary)" : "var(--text-secondary)" }}
                        >
                          {highlightMatch((stream.name || "").replace("#", ""), matchedField, "name")}
                        </span>
                        {isPrivate && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}
                          >
                            Private
                          </span>
                        )}
                      </div>
                      {(stream.topic || stream.description) && (
                        <p className="text-sm truncate" style={{ color: "var(--text-muted)" }}>
                          {matchedField === "topic" && stream.topic
                            ? highlightMatch(stream.topic, matchedField, "topic")
                            : matchedField === "description" && stream.description
                              ? highlightMatch(stream.description, matchedField, "description")
                              : stream.topic || stream.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full"
                        style={{
                          background: isMember ? "rgba(34, 197, 94, 0.15)" : "var(--bg-tertiary)",
                          color: isMember ? "rgb(34, 197, 94)" : "var(--text-muted)",
                        }}
                      >
                        <MemberIcon className="h-3 w-3" />
                        <span>{isMember ? "Joined" : "Join"}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectStream(stream, "side")
                          onClose()
                        }}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
                        style={{ color: "var(--text-muted)" }}
                        title="Open to side"
                      >
                        <PanelRightOpen className="h-4 w-4" />
                      </button>
                    </div>
                  </button>
                )
              })
            )
          ) : // Search results
          !isOnline ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <WifiOff className="h-10 w-10 mb-3" style={{ color: "var(--text-muted)" }} />
              <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                You're offline
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                Search requires an internet connection
              </p>
            </div>
          ) : searchError ? (
            <div className="px-4 py-8 text-center" style={{ color: "var(--error)" }}>
              {searchError}
            </div>
          ) : isSearching ? (
            <div className="px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>
              Searching...
            </div>
          ) : !query.trim() &&
            !searchFilters.users.length &&
            !searchFilters.withUsers.length &&
            !searchFilters.channels.length &&
            !searchFilters.streamTypes.length ? (
            <div className="px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>
              Type to search messages...
            </div>
          ) : searchResults.length === 0 ? (
            <div className="px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>
              No messages found{query ? ` for "${query}"` : " matching filters"}
            </div>
          ) : (
            searchResults.map((result, index) => {
              const isSelected = index === selectedIndex
              const Icon = result.type === "knowledge" ? FileText : MessageSquare

              return (
                <button
                  key={`${result.type}-${result.id}`}
                  onClick={(e) => {
                    const streamSlugOrId = result.streamSlug || result.streamId
                    if (streamSlugOrId && onNavigateToMessage) {
                      onNavigateToMessage(streamSlugOrId, result.id, getOpenMode(e))
                      onClose()
                    }
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors group"
                  style={{ background: isSelected ? "var(--hover-overlay)" : "transparent" }}
                >
                  <Icon
                    className="h-4 w-4 flex-shrink-0 mt-0.5"
                    style={{ color: isSelected ? "var(--accent-primary)" : "var(--text-muted)" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {result.actor && (
                        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {result.actor.name}
                        </span>
                      )}
                      {result.streamName && (
                        <>
                          <span style={{ color: "var(--text-muted)" }}>in</span>
                          <span
                            className="text-sm flex items-center gap-0.5"
                            style={{ color: "var(--accent-primary)" }}
                          >
                            <Hash className="h-3 w-3" />
                            {result.streamName}
                          </span>
                        </>
                      )}
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {formatRelativeTime(result.createdAt)}
                      </span>
                    </div>
                    <p
                      className="text-sm line-clamp-2"
                      style={{ color: isSelected ? "var(--text-primary)" : "var(--text-secondary)" }}
                    >
                      {result.highlights ? renderHighlights(result.highlights) : result.content}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const streamSlugOrId = result.streamSlug || result.streamId
                      if (streamSlugOrId && onNavigateToMessage) {
                        onNavigateToMessage(streamSlugOrId, result.id, "side")
                        onClose()
                      }
                    }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
                    style={{ color: "var(--text-muted)" }}
                    title="Open to side"
                  >
                    <PanelRightOpen className="h-4 w-4" />
                  </button>
                </button>
              )
            })
          )}
        </div>

        {/* Footer with keyboard hints */}
        <div
          className="flex items-center justify-between px-4 py-2 text-xs"
          style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}
        >
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded" style={{ background: "var(--bg-tertiary)" }}>
                Tab
              </kbd>
              Switch mode
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded" style={{ background: "var(--bg-tertiary)" }}>
                ↑↓
              </kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded" style={{ background: "var(--bg-tertiary)" }}>
                Enter
              </kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded" style={{ background: "var(--bg-tertiary)" }}>
                Esc
              </kbd>
              Close
            </span>
          </div>
          {mode === "navigate" && scoredStreams.length > 0 && (
            <span>
              {scoredStreams.length} channel{scoredStreams.length !== 1 ? "s" : ""}
            </span>
          )}
          {mode === "search" && searchResults.length > 0 && (
            <span>
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
