import { useCallback } from "react"
import type { Mentionable } from "./types"
import { MentionList } from "./mention-list"
import { filterMentionables, useMentionables } from "@/hooks/use-mentionables"
import { useSuggestion } from "./use-suggestion"

/**
 * Hook that manages the mention suggestion state and provides render callbacks.
 * Returns configuration for the MentionExtension and a render function for the popup.
 */
export function useMentionSuggestion() {
  const { mentionables } = useMentionables()

  const renderList = useCallback(
    (props: {
      ref: React.RefObject<{ onKeyDown: (event: KeyboardEvent) => boolean } | null>
      items: Mentionable[]
      clientRect: (() => DOMRect | null) | null
      command: (item: Mentionable) => void
    }) => <MentionList ref={props.ref} items={props.items} clientRect={props.clientRect} command={props.command} />,
    []
  )

  const { suggestionConfig, renderSuggestionList, isActive } = useSuggestion<Mentionable>({
    getItems: () => mentionables,
    filterItems: filterMentionables,
    renderList,
  })

  return {
    suggestionConfig,
    renderMentionList: renderSuggestionList,
    isActive,
  }
}
