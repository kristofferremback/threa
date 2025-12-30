import { forwardRef, useCallback } from "react"
import { Calendar } from "lucide-react"
import { SuggestionList, type SuggestionListRef, type SuggestionListProps } from "./suggestion-list"
import type { DateFilterItem } from "./date-filter-extension"

interface DateFilterListProps extends Omit<
  SuggestionListProps<DateFilterItem>,
  "getKey" | "ariaLabel" | "renderItem"
> {}

export const DateFilterList = forwardRef<SuggestionListRef, DateFilterListProps>(function DateFilterList(
  { items, clientRect, command },
  ref
) {
  const renderItem = useCallback((item: DateFilterItem) => <DateFilterItemContent item={item} />, [])

  return (
    <SuggestionList
      ref={ref}
      items={items}
      clientRect={clientRect}
      command={command}
      getKey={(item) => item.id}
      ariaLabel="Date options"
      width="220px"
      renderItem={renderItem}
    />
  )
})

function DateFilterItemContent({ item }: { item: DateFilterItem }) {
  return (
    <>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
        <Calendar className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex flex-1 flex-col items-start min-w-0">
        <span className="font-medium">{item.label}</span>
        <span className="text-xs text-muted-foreground">{item.description}</span>
      </div>
    </>
  )
}
