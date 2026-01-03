import { useCallback } from "react"
import { useSuggestion } from "./use-suggestion"
import { StatusFilterList } from "./status-filter-list"
import { STATUS_FILTER_OPTIONS, type StatusFilterItem } from "./status-filter-extension"

/**
 * Filters status options by query string.
 */
export function filterStatusOptions(items: StatusFilterItem[], query: string): StatusFilterItem[] {
  if (!query) return items

  const lowerQuery = query.toLowerCase()
  return items.filter(
    (item) =>
      item.value.toLowerCase().startsWith(lowerQuery) ||
      item.label.toLowerCase().includes(lowerQuery) ||
      item.description.toLowerCase().includes(lowerQuery)
  )
}

/**
 * Hook for managing status filter suggestions (`status:` trigger).
 */
export function useStatusFilterSuggestion() {
  const getItems = useCallback(() => STATUS_FILTER_OPTIONS, [])

  const renderList = useCallback(
    (props: {
      ref: React.RefObject<import("./suggestion-list").SuggestionListRef | null>
      items: StatusFilterItem[]
      clientRect: (() => DOMRect | null) | null
      command: (item: StatusFilterItem) => void
    }) => (
      <StatusFilterList ref={props.ref} items={props.items} clientRect={props.clientRect} command={props.command} />
    ),
    []
  )

  const { suggestionConfig, renderSuggestionList, isActive, close } = useSuggestion<StatusFilterItem>({
    getItems,
    filterItems: filterStatusOptions,
    renderList,
  })

  return {
    suggestionConfig,
    renderStatusFilterList: renderSuggestionList,
    isActive,
    close,
  }
}
