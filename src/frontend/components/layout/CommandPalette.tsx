import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import { Hash, Lock, Search, X, UserCheck, UserPlus } from "lucide-react"
import type { Channel } from "../../types"

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  channels: Channel[]
  onSelectChannel: (channel: Channel) => void
}

interface ScoredChannel {
  channel: Channel
  score: number
  matchType: "exact" | "startsWith" | "contains" | "fuzzy"
  matchedField: "name" | "slug" | "topic" | "description"
}

// Fuzzy matching score calculator
function calculateFuzzyScore(query: string, text: string): { score: number; matchType: ScoredChannel["matchType"] } {
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

// Score a channel against the query
function scoreChannel(channel: Channel, query: string): ScoredChannel | null {
  if (!query.trim()) {
    // No query - return all channels sorted by membership
    return {
      channel,
      score: channel.is_member ? 100 : 50,
      matchType: "exact",
      matchedField: "name",
    }
  }

  const fieldsToSearch: Array<{ field: ScoredChannel["matchedField"]; text: string | null; weight: number }> = [
    { field: "name", text: channel.name.replace("#", ""), weight: 1.0 },
    { field: "slug", text: channel.slug, weight: 0.9 },
    { field: "topic", text: channel.topic, weight: 0.6 },
    { field: "description", text: channel.description, weight: 0.5 },
  ]

  let bestScore = 0
  let bestMatchType: ScoredChannel["matchType"] = "fuzzy"
  let bestMatchedField: ScoredChannel["matchedField"] = "name"

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
  const membershipMultiplier = channel.is_member ? 1.5 : 1.0
  const finalScore = bestScore * membershipMultiplier

  return {
    channel,
    score: finalScore,
    matchType: bestMatchType,
    matchedField: bestMatchedField,
  }
}

export function CommandPalette({ open, onClose, channels, onSelectChannel }: CommandPaletteProps) {
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter and score channels based on query
  const scoredChannels = useMemo(() => {
    const results: ScoredChannel[] = []

    for (const channel of channels) {
      const scored = scoreChannel(channel, query)
      if (scored) {
        results.push(scored)
      }
    }

    // Sort by score (descending), then by name (ascending) for ties
    results.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }
      return a.channel.name.localeCompare(b.channel.name)
    })

    return results
  }, [channels, query])

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
    if (selectedIndex >= scoredChannels.length) {
      setSelectedIndex(Math.max(0, scoredChannels.length - 1))
    }
  }, [scoredChannels.length, selectedIndex])

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
          setSelectedIndex((prev) => Math.min(prev + 1, scoredChannels.length - 1))
          break
        case "ArrowUp":
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case "Enter":
          e.preventDefault()
          if (scoredChannels[selectedIndex]) {
            onSelectChannel(scoredChannels[selectedIndex].channel)
            onClose()
          }
          break
        case "Escape":
          e.preventDefault()
          onClose()
          break
      }
    },
    [scoredChannels, selectedIndex, onSelectChannel, onClose],
  )

  // Global keyboard shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
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
  const highlightMatch = (text: string, matchedField: ScoredChannel["matchedField"], field: string) => {
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
          {scoredChannels.length === 0 ? (
            <div className="px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>
              {query ? `No channels matching "${query}"` : "No channels available"}
            </div>
          ) : (
            scoredChannels.map((scored, index) => {
              const { channel, matchedField } = scored
              const isPrivate = channel.visibility === "private"
              const Icon = isPrivate ? Lock : Hash
              const isSelected = index === selectedIndex
              const isMember = channel.is_member
              const MemberIcon = isMember ? UserCheck : UserPlus

              return (
                <button
                  key={channel.id}
                  onClick={() => {
                    onSelectChannel(channel)
                    onClose()
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                  style={{
                    background: isSelected ? "var(--hover-overlay)" : "transparent",
                  }}
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
                        {highlightMatch(channel.name.replace("#", ""), matchedField, "name")}
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
                    {(channel.topic || channel.description) && (
                      <p className="text-sm truncate" style={{ color: "var(--text-muted)" }}>
                        {matchedField === "topic" && channel.topic
                          ? highlightMatch(channel.topic, matchedField, "topic")
                          : matchedField === "description" && channel.description
                            ? highlightMatch(channel.description, matchedField, "description")
                            : channel.topic || channel.description}
                      </p>
                    )}
                  </div>
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
                Esc
              </kbd>
              Close
            </span>
          </div>
          {scoredChannels.length > 0 && (
            <span>
              {scoredChannels.length} result{scoredChannels.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
