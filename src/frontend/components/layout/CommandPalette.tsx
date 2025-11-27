import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import { Hash, Lock, Search, X, UserCheck, UserPlus, PanelRightOpen } from "lucide-react"
import type { Stream, OpenMode } from "../../types"
import { getOpenMode } from "../../types"

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  streams: Stream[]
  onSelectStream: (stream: Stream, mode: OpenMode) => void
}

interface ScoredStream {
  stream: Stream
  score: number
  matchType: "exact" | "startsWith" | "contains" | "fuzzy"
  matchedField: "name" | "slug" | "topic" | "description"
}

// Fuzzy matching score calculator
function calculateFuzzyScore(query: string, text: string): { score: number; matchType: ScoredStream["matchType"] } {
  const lowerQuery = query.toLowerCase()
  const lowerText = text.toLowerCase()

  // Exact match - highest score
  if (lowerText === lowerQuery) {
    return { score: 100, matchType: "exact" }
  }

  // Starts with - very high score
  if (lowerText.startsWith(lowerQuery)) {
    return { score: 90 - (lowerText.length - lowerQuery.length) * 0.5, matchType: "startsWith" }
  }

  // Contains as substring - high score
  const containsIndex = lowerText.indexOf(lowerQuery)
  if (containsIndex !== -1) {
    // Prefer matches earlier in the string
    const positionPenalty = containsIndex * 0.5
    return { score: 70 - positionPenalty, matchType: "contains" }
  }

  // Fuzzy match - check if all query characters appear in order
  let queryIndex = 0
  let matchedChars = 0
  let consecutiveBonus = 0
  let lastMatchIndex = -2

  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      matchedChars++
      // Bonus for consecutive matches
      if (i === lastMatchIndex + 1) {
        consecutiveBonus += 5
      }
      lastMatchIndex = i
      queryIndex++
    }
  }

  // All query characters found in order
  if (queryIndex === lowerQuery.length) {
    const baseScore = 30 + (matchedChars / lowerText.length) * 20 + consecutiveBonus
    return { score: Math.min(baseScore, 60), matchType: "fuzzy" }
  }

  return { score: 0, matchType: "fuzzy" }
}

// Score a stream against the query
function scoreStream(stream: Stream, query: string): ScoredStream | null {
  if (!query.trim()) {
    // No query - return all streams sorted by membership
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

  // No match found
  if (bestScore === 0) {
    return null
  }

  // Apply membership multiplier (1.5x for members)
  const membershipMultiplier = stream.isMember ? 1.5 : 1.0
  const finalScore = bestScore * membershipMultiplier

  return {
    stream,
    score: finalScore,
    matchType: bestMatchType,
    matchedField: bestMatchedField,
  }
}

export function CommandPalette({ open, onClose, streams, onSelectStream }: CommandPaletteProps) {
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter to only show channels and score based on query
  const scoredStreams = useMemo(() => {
    const results: ScoredStream[] = []

    for (const stream of streams) {
      // Only show channels in the palette
      if (stream.streamType !== "channel") continue

      const scored = scoreStream(stream, query)
      if (scored) {
        results.push(scored)
      }
    }

    // Sort by score (descending), then by name (ascending) for ties
    results.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }
      return (a.stream.name || "").localeCompare(b.stream.name || "")
    })

    return results
  }, [streams, query])

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("")
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= scoredStreams.length) {
      setSelectedIndex(Math.max(0, scoredStreams.length - 1))
    }
  }, [scoredStreams.length, selectedIndex])

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
          setSelectedIndex((prev) => Math.min(prev + 1, scoredStreams.length - 1))
          break
        case "ArrowUp":
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case "Enter":
          e.preventDefault()
          if (scoredStreams[selectedIndex]) {
            // Support modifier keys for open mode
            let mode: OpenMode = "replace"
            if (e.metaKey || e.ctrlKey) mode = "newTab"
            else if (e.altKey) mode = "side"
            onSelectStream(scoredStreams[selectedIndex].stream, mode)
            onClose()
          }
          break
        case "Escape":
          e.preventDefault()
          onClose()
          break
      }
    },
    [scoredStreams, selectedIndex, onSelectStream, onClose],
  )

  // Global keyboard shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault()
        if (open) {
          onClose()
        }
      }
    }

    document.addEventListener("keydown", handleGlobalKeyDown)
    return () => document.removeEventListener("keydown", handleGlobalKeyDown)
  }, [open, onClose])

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
        className="w-full max-w-xl rounded-xl overflow-hidden animate-fade-in shadow-2xl"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
      >
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
            placeholder="Search channels..."
            className="flex-1 bg-transparent outline-none text-base"
            style={{ color: "var(--text-primary)" }}
          />
          {query && (
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
        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {scoredStreams.length === 0 ? (
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
                  style={{
                    background: isSelected ? "var(--hover-overlay)" : "transparent",
                  }}
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
                ⌥+Enter
              </kbd>
              Side
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded" style={{ background: "var(--bg-tertiary)" }}>
                Esc
              </kbd>
              Close
            </span>
          </div>
          {scoredStreams.length > 0 && (
            <span>
              {scoredStreams.length} result{scoredStreams.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
