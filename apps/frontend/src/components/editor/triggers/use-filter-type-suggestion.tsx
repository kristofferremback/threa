import { useCallback } from "react"
import { useSuggestion } from "./use-suggestion"
import { FilterTypeList } from "./filter-type-list"
import { FILTER_TYPE_OPTIONS, type FilterTypeItem } from "./filter-type-extension"

/**
 * Filters stream type options by query string.
 */
export function filterFilterTypes(items: FilterTypeItem[], query: string): FilterTypeItem[] {
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
 * Hook for managing filter type suggestions (`is:` trigger).
 */
export function useFilterTypeSuggestion() {
  const getItems = useCallback(() => FILTER_TYPE_OPTIONS, [])

  const renderList = useCallback(
    (props: {
      ref: React.RefObject<import("./suggestion-list").SuggestionListRef | null>
      items: FilterTypeItem[]
      clientRect: (() => DOMRect | null) | null
      command: (item: FilterTypeItem) => void
    }) => <FilterTypeList ref={props.ref} items={props.items} clientRect={props.clientRect} command={props.command} />,
    []
  )

  const { suggestionConfig, renderSuggestionList, isActive, close } = useSuggestion<FilterTypeItem>({
    getItems,
    filterItems: filterFilterTypes,
    renderList,
  })

  return {
    suggestionConfig,
    renderFilterTypeList: renderSuggestionList,
    isActive,
    close,
  }
}
