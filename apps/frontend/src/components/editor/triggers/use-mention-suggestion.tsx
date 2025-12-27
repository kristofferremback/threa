import { useState, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"
import type { Mentionable } from "./types"
import { MentionList, type MentionListRef } from "./mention-list"
import { filterMentionables, useMentionables } from "@/hooks/use-mentionables"

interface SuggestionState {
  items: Mentionable[]
  clientRect: (() => DOMRect | null) | null
  command: ((item: Mentionable) => void) | null
}

/**
 * Hook that manages the mention suggestion state and provides render callbacks.
 * Returns configuration for the MentionExtension and a render function for the popup.
 */
export function useMentionSuggestion() {
  const { mentionables } = useMentionables()
  const [state, setState] = useState<SuggestionState | null>(null)
  const listRef = useRef<MentionListRef>(null)

  // Use ref to avoid stale closure in TipTap callback
  const mentionablesRef = useRef(mentionables)
  mentionablesRef.current = mentionables

  // Use stable callback that reads from ref - TipTap captures this at extension creation time
  const getSuggestionItems = useCallback(
    ({ query }: { query: string }) => filterMentionables(mentionablesRef.current, query),
    [] // Empty deps - callback is stable, reads current value from ref
  )

  const onStart = useCallback((props: SuggestionProps<Mentionable>) => {
    setState({
      items: props.items,
      clientRect: props.clientRect ?? null,
      command: props.command,
    })
  }, [])

  const onUpdate = useCallback((props: SuggestionProps<Mentionable>) => {
    setState({
      items: props.items,
      clientRect: props.clientRect ?? null,
      command: props.command,
    })
  }, [])

  const onExit = useCallback(() => {
    setState(null)
  }, [])

  const onKeyDown = useCallback((props: SuggestionKeyDownProps) => {
    if (props.event.key === "Escape") {
      setState(null)
      return true
    }
    return listRef.current?.onKeyDown(props.event) ?? false
  }, [])

  const suggestionConfig = {
    items: getSuggestionItems,
    render: () => ({
      onStart,
      onUpdate,
      onExit,
      onKeyDown,
    }),
  }

  const renderMentionList = useCallback(() => {
    if (!state || !state.command) return null

    return createPortal(
      <MentionList ref={listRef} items={state.items} clientRect={state.clientRect} command={state.command} />,
      document.body
    )
  }, [state])

  return {
    suggestionConfig,
    renderMentionList,
  }
}
