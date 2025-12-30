import { useCallback } from "react"
import type { Mentionable } from "./types"
import { MentionList } from "./mention-list"
import { filterSearchMentionables, useMentionables } from "@/hooks/use-mentionables"
import { useSuggestion } from "./use-suggestion"

/**
 * Hook for `in:@` filter suggestions in search context.
 * Shows users/personas when typing `in:@` for DM filtering.
 */
export function useInUserFilterSuggestion() {
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
    filterItems: filterSearchMentionables,
    renderList,
  })

  return {
    suggestionConfig,
    renderInUserFilterList: renderSuggestionList,
    isActive,
  }
}
