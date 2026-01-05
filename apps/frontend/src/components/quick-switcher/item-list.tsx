import { useEffect, useRef } from "react"
import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { QuickSwitcherItem } from "./types"

interface ItemListProps {
  items: QuickSwitcherItem[]
  selectedIndex: number
  onSelectIndex: (index: number) => void
  onSelectItem: (item: QuickSwitcherItem, withModifier: boolean) => void
  isLoading?: boolean
  emptyMessage?: string
}

export function ItemList({
  items,
  selectedIndex,
  onSelectIndex,
  onSelectItem,
  isLoading,
  emptyMessage,
}: ItemListProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const selectedElement = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      selectedElement?.scrollIntoView({ block: "nearest" })
    }
  }, [selectedIndex])

  if (isLoading) {
    return <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>
  }

  if (items.length === 0 && emptyMessage) {
    return <div className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</div>
  }

  if (items.length === 0) {
    return null
  }

  // Group items by their group property
  const groups = items.reduce(
    (acc, item, index) => {
      const group = item.group ?? ""
      if (!acc[group]) {
        acc[group] = []
      }
      acc[group].push({ item, index })
      return acc
    },
    {} as Record<string, Array<{ item: QuickSwitcherItem; index: number }>>
  )

  const handleClick = (e: React.MouseEvent, item: QuickSwitcherItem) => {
    const isModifier = e.metaKey || e.ctrlKey
    if (isModifier && item.href) {
      // Let the browser handle Cmd+click on links natively (opens in new tab)
      return
    }
    e.preventDefault()
    onSelectItem(item, isModifier)
  }

  return (
    <div ref={listRef} role="listbox" className="max-h-[400px] overflow-y-auto p-1">
      {Object.entries(groups).map(([groupName, groupItems]) => (
        <div key={groupName || "_ungrouped"} role="group" aria-label={groupName || undefined} className="mb-1">
          {groupName && <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{groupName}</div>}
          {groupItems.map(({ item, index }) => {
            const Icon = item.icon
            const ActionIcon = item.actionIcon
            const isSelected = index === selectedIndex

            const itemContent = (
              <>
                {Icon && <Icon className="h-4 w-4 opacity-50" />}
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="truncate">{item.label}</span>
                  {item.description && (
                    <span className="text-xs text-muted-foreground truncate">{item.description}</span>
                  )}
                </div>
                {item.onAction && ActionIcon && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      item.onAction?.()
                    }}
                    aria-label={item.actionLabel}
                  >
                    <ActionIcon className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                )}
              </>
            )

            const className = cn(
              "group relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none",
              isSelected && "bg-accent text-accent-foreground"
            )

            if (item.href) {
              return (
                <Link
                  key={item.id}
                  to={item.href}
                  role="option"
                  aria-selected={isSelected}
                  data-index={index}
                  className={className}
                  onMouseEnter={() => onSelectIndex(index)}
                  onClick={(e) => handleClick(e, item)}
                >
                  {itemContent}
                </Link>
              )
            }

            return (
              <div
                key={item.id}
                role="option"
                aria-selected={isSelected}
                data-index={index}
                className={className}
                onMouseEnter={() => onSelectIndex(index)}
                onClick={(e) => handleClick(e, item)}
              >
                {itemContent}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
