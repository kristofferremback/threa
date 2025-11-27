import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import { Hash, Lock, Search, X, UserCheck, UserPlus, PanelRightOpen, MessageSquare, FileText, User } from "lucide-react"
import type { Stream, OpenMode } from "../../types"
import { getOpenMode } from "../../types"

type PaletteMode = "navigate" | "search"

interface CommandPaletteProps {
  open: boolean
  mode?: PaletteMode
  onClose: () => void
  streams: Stream[]
  workspaceId: string
  onSelectStream: (stream: Stream, mode: OpenMode) => void
  onNavigateToMessage?: (streamSlug: string, eventId: string, mode: OpenMode) => void
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

export function CommandPalette({
  open,
  mode: initialMode = "navigate",
  onClose,
  streams,
  workspaceId,
  onSelectStream,
  onNavigateToMessage,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<PaletteMode>(initialMode)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    if (mode !== "search" || !query.trim()) {
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
        const res = await fetch(
          `/api/workspace/${workspaceId}/search?query=${encodeURIComponent(query)}&limit=20`,
          { credentials: "include" },
        )

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
  }, [query, mode, workspaceId])

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("")
      setSelectedIndex(0)
      setMode(initialMode)
      setSearchResults([])
      setSearchError(null)
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
            if (result.streamSlug && onNavigateToMessage) {
              let openMode: OpenMode = "replace"
              if (e.metaKey || e.ctrlKey) openMode = "newTab"
              else if (e.altKey) openMode = "side"
              onNavigateToMessage(result.streamSlug, result.id, openMode)
              onClose()
            }
          }
          break
        case "Escape":
          e.preventDefault()
          onClose()
          break
      }
    },
    [mode, scoredStreams, searchResults, selectedIndex, itemCount, onSelectStream, onNavigateToMessage, onClose],
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
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <Search className="h-5 w-5 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder={mode === "navigate" ? "Search channels..." : "Search messages..."}
            className="flex-1 bg-transparent outline-none text-base"
            style={{ color: "var(--text-primary)" }}
          />
          {isSearching && (
            <div
              className="h-4 w-4 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: "var(--text-muted)", borderTopColor: "transparent" }}
            />
          )}
          {query && !isSearching && (
            <button
              onClick={() => {
                setQuery("")
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
          searchError ? (
            <div className="px-4 py-8 text-center" style={{ color: "var(--error)" }}>
              {searchError}
            </div>
          ) : !query.trim() ? (
            <div className="px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>
              Type to search messages...
            </div>
          ) : isSearching ? (
            <div className="px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>
              Searching...
            </div>
          ) : searchResults.length === 0 ? (
            <div className="px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>
              No messages found for "{query}"
            </div>
          ) : (
            searchResults.map((result, index) => {
              const isSelected = index === selectedIndex
              const Icon = result.type === "knowledge" ? FileText : MessageSquare

              return (
                <button
                  key={`${result.type}-${result.id}`}
                  onClick={(e) => {
                    if (result.streamSlug && onNavigateToMessage) {
                      onNavigateToMessage(result.streamSlug, result.id, getOpenMode(e))
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
                          <span className="text-sm flex items-center gap-0.5" style={{ color: "var(--accent-primary)" }}>
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
                      if (result.streamSlug && onNavigateToMessage) {
                        onNavigateToMessage(result.streamSlug, result.id, "side")
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
