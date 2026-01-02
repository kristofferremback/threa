import { forwardRef, useCallback } from "react"
import { Archive, Circle } from "lucide-react"
import { SuggestionList, type SuggestionListRef, type SuggestionListProps } from "./suggestion-list"
import type { StatusFilterItem } from "./status-filter-extension"

const STATUS_FILTER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  active: Circle,
  archived: Archive,
}

interface StatusFilterListProps extends Omit<
  SuggestionListProps<StatusFilterItem>,
  "getKey" | "ariaLabel" | "renderItem"
> {}

export const StatusFilterList = forwardRef<SuggestionListRef, StatusFilterListProps>(function StatusFilterList(
  { items, clientRect, command, placement },
  ref
) {
  const renderItem = useCallback((item: StatusFilterItem) => <StatusFilterItemContent item={item} />, [])

  return (
    <SuggestionList
      ref={ref}
      items={items}
      clientRect={clientRect}
      command={command}
      getKey={(item) => item.id}
      ariaLabel="Stream status options"
      width="240px"
      renderItem={renderItem}
      placement={placement}
    />
  )
})

function StatusFilterItemContent({ item }: { item: StatusFilterItem }) {
  const Icon = STATUS_FILTER_ICONS[item.value] ?? Circle

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
