import { useCallback } from "react"
import type { Mentionable } from "./types"
import { MentionList } from "./mention-list"
import { filterSearchMentionables, useMentionables } from "@/hooks/use-mentionables"
import { useSuggestion } from "./use-suggestion"

/**
 * Hook for @mention suggestions in search context.
 * Unlike the regular useMentionSuggestion, this excludes broadcast mentions
 * (@channel, @here) since they don't make sense to search for.
 */
export function useSearchMentionSuggestion() {
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

  const { suggestionConfig, renderSuggestionList, isActive, close } = useSuggestion<Mentionable>({
    getItems: () => mentionables,
    filterItems: filterSearchMentionables,
    renderList,
  })

  return {
    suggestionConfig,
    renderMentionList: renderSuggestionList,
    isActive,
    close,
  }
}
