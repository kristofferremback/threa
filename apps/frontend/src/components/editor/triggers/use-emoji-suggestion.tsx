import { useState, useCallback, useRef, useMemo, type RefObject, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"
import type { EmojiEntry } from "@threa/types"
import type { SuggestionListRef } from "./suggestion-list"
import { EmojiGrid } from "./emoji-grid"

interface EmojiSuggestionState {
  items: EmojiEntry[]
  clientRect: (() => DOMRect | null) | null
  command: ((item: EmojiEntry) => void) | null
}

export interface UseEmojiSuggestionConfig {
  /** All emojis available in the workspace */
  emojis: EmojiEntry[]
  /** Emoji weights for personalized sorting */
  emojiWeights: Record<string, number>
}

export interface UseEmojiSuggestionResult {
  /** Configuration to pass to the TipTap extension */
  suggestionConfig: {
    items: (props: { query: string }) => EmojiEntry[]
    render: () => {
      onStart: (props: SuggestionProps<EmojiEntry>) => void
      onUpdate: (props: SuggestionProps<EmojiEntry>) => void
      onExit: () => void
      onKeyDown: (props: SuggestionKeyDownProps) => boolean
    }
  }
  /** Call this in your component to render the suggestion popup */
  renderEmojiGrid: () => ReactNode
  /** Whether the suggestion popup is currently active */
  isActive: boolean
  /** Imperatively close the suggestion popup */
  close: () => void
}

const GROUP_ORDER = ["smileys", "people", "animals", "food", "travel", "activities", "objects", "symbols", "flags"]

/**
 * Hook for managing emoji suggestion state with personalized sorting.
 *
 * Sorting order:
 * 1. Weighted emojis first (by weight descending)
 * 2. Then by group (smileys → people → animals → ...)
 * 3. Then by in-group order
 */
export function useEmojiSuggestion(config: UseEmojiSuggestionConfig): UseEmojiSuggestionResult {
  const { emojis, emojiWeights } = config
  const [state, setState] = useState<EmojiSuggestionState | null>(null)
  const listRef = useRef<SuggestionListRef>(null)

  // Pre-sort emojis for consistent ordering
  const sortedEmojis = useMemo(() => {
    return [...emojis].sort((a, b) => {
      const weightA = emojiWeights[a.shortcode] ?? 0
      const weightB = emojiWeights[b.shortcode] ?? 0

      // Weighted emojis first
      if (weightA > 0 && weightB === 0) return -1
      if (weightA === 0 && weightB > 0) return 1
      if (weightA !== weightB) return weightB - weightA

      // Then by group
      const groupIndexA = GROUP_ORDER.indexOf(a.group)
      const groupIndexB = GROUP_ORDER.indexOf(b.group)
      // Unknown groups go to the end
      const effectiveGroupA = groupIndexA === -1 ? GROUP_ORDER.length : groupIndexA
      const effectiveGroupB = groupIndexB === -1 ? GROUP_ORDER.length : groupIndexB
      if (effectiveGroupA !== effectiveGroupB) return effectiveGroupA - effectiveGroupB

      // Then by in-group order
      return a.order - b.order
    })
  }, [emojis, emojiWeights])

  // Use ref to avoid stale closure - TipTap captures callbacks at extension creation time
  const sortedEmojisRef = useRef(sortedEmojis)
  sortedEmojisRef.current = sortedEmojis

  // Filter emojis by query (shortcode contains query)
  const filterItems = useCallback((items: EmojiEntry[], query: string): EmojiEntry[] => {
    if (!query) return items.slice(0, 64) // Show first 64 when no query
    const lowerQuery = query.toLowerCase()
    return items.filter((item) => item.shortcode.includes(lowerQuery)).slice(0, 64)
  }, [])

  // Stable callback that reads from ref
  const getSuggestionItems = useCallback(
    ({ query }: { query: string }) => filterItems(sortedEmojisRef.current, query),
    [filterItems]
  )

  const onStart = useCallback((props: SuggestionProps<EmojiEntry>) => {
    setState({
      items: props.items,
      clientRect: props.clientRect ?? null,
      command: props.command,
    })
  }, [])

  const onUpdate = useCallback((props: SuggestionProps<EmojiEntry>) => {
    setState({
      items: props.items,
      clientRect: props.clientRect ?? null,
      command: props.command,
    })
  }, [])

  const onExit = useCallback(() => {
    setState(null)
  }, [])

  const close = useCallback(() => {
    setState(null)
  }, [])

  const onKeyDown = useCallback((props: SuggestionKeyDownProps) => {
    if (props.event.key === "Escape") {
      props.event.preventDefault()
      setState(null)
      return true
    }
    return listRef.current?.onKeyDown(props.event) ?? false
  }, [])

  const suggestionConfig = useMemo(
    () => ({
      items: getSuggestionItems,
      render: () => ({
        onStart,
        onUpdate,
        onExit,
        onKeyDown,
      }),
    }),
    [getSuggestionItems, onStart, onUpdate, onExit, onKeyDown]
  )

  const renderEmojiGrid = useCallback(() => {
    if (!state || !state.command) return null

    return createPortal(
      <EmojiGrid
        ref={listRef as RefObject<SuggestionListRef>}
        items={state.items}
        clientRect={state.clientRect}
        command={state.command}
      />,
      document.body
    )
  }, [state])

  return {
    suggestionConfig,
    renderEmojiGrid,
    isActive: state !== null,
    close,
  }
}
