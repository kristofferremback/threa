import { forwardRef, useCallback } from "react"
import { FileText, Hash, MessageSquare, GitBranch } from "lucide-react"
import { SuggestionList, type SuggestionListRef, type SuggestionListProps } from "./suggestion-list"
import type { FilterTypeItem } from "./filter-type-extension"

const FILTER_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  scratchpad: FileText,
  channel: Hash,
  dm: MessageSquare,
  thread: GitBranch,
}

interface FilterTypeListProps extends Omit<
  SuggestionListProps<FilterTypeItem>,
  "getKey" | "ariaLabel" | "renderItem"
> {}

export const FilterTypeList = forwardRef<SuggestionListRef, FilterTypeListProps>(function FilterTypeList(
  { items, clientRect, command },
  ref
) {
  const renderItem = useCallback((item: FilterTypeItem) => <FilterTypeItemContent item={item} />, [])

  return (
    <SuggestionList
      ref={ref}
      items={items}
      clientRect={clientRect}
      command={command}
      getKey={(item) => item.id}
      ariaLabel="Stream type options"
      width="240px"
      renderItem={renderItem}
    />
  )
})

function FilterTypeItemContent({ item }: { item: FilterTypeItem }) {
  const Icon = FILTER_TYPE_ICONS[item.value] ?? Hash

  return (
    <>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex flex-1 flex-col items-start min-w-0">
        <span className="font-medium">{item.label}</span>
        <span className="text-xs text-muted-foreground truncate">{item.description}</span>
      </div>
    </>
  )
}
