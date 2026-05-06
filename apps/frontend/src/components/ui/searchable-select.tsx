import { type ReactNode, useState, useEffect } from "react"
import { ChevronsUpDown } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface SearchableSelectProps<T> {
  items: T[]
  value: T | null
  onChange: (item: T) => void
  /** Stable unique id for the item — used as React key and cmdk value. */
  getKey: (item: T) => string
  /** Search keywords matched by the cmdk fuzzy filter (e.g. [name, `@${slug}`]). */
  getKeywords: (item: T) => string[]
  /** Row rendered inside the popover list. */
  renderItem: (item: T, isSelected: boolean) => ReactNode
  /** Trigger label when a value is selected. Defaults to renderItem with selected=true. */
  renderSelected?: (item: T) => ReactNode
  /** Trigger label when no value is selected. */
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  /** Optional icon left of the trigger label. */
  triggerIcon?: LucideIcon
  /**
   * When no value is selected, append a subtle "· N available" hint to the trigger
   * so users can see how many options exist before opening.
   */
  showAvailableCount?: boolean
  availableLabel?: (n: number) => string
  disabled?: boolean
  className?: string
  contentClassName?: string
  align?: "start" | "center" | "end"
  /** Extra rows rendered above the items list (e.g. a "device timezone" suggestion). */
  prefixContent?: (helpers: { close: () => void }) => ReactNode
  /** Test id forwarded to the trigger. */
  "data-testid"?: string
}

export function SearchableSelect<T>({
  items,
  value,
  onChange,
  getKey,
  getKeywords,
  renderItem,
  renderSelected,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "No results found.",
  triggerIcon: TriggerIcon,
  showAvailableCount = false,
  availableLabel = (n) => `${n} available`,
  disabled = false,
  className,
  contentClassName,
  align = "start",
  prefixContent,
  "data-testid": testId,
}: SearchableSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  // Reset filter input each time the popover closes so the next open shows the full list.
  useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  const handleSelect = (item: T) => {
    onChange(item)
    setOpen(false)
  }

  const triggerContent = value ? (
    <span className="flex items-center gap-2 min-w-0 flex-1 truncate">
      {TriggerIcon && <TriggerIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <span className="truncate">{(renderSelected ?? ((v: T) => renderItem(v, true)))(value)}</span>
    </span>
  ) : (
    <span className="flex items-center gap-2 min-w-0 flex-1 truncate font-normal text-muted-foreground">
      {TriggerIcon && <TriggerIcon className="h-4 w-4 shrink-0" />}
      <span className="truncate">{placeholder}</span>
      {showAvailableCount && items.length > 0 && (
        <span className="ml-auto pl-2 text-xs text-muted-foreground/70 shrink-0 tabular-nums">
          {availableLabel(items.length)}
        </span>
      )}
    </span>
  )

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={testId}
          className={cn("w-full justify-between gap-2 font-normal", className)}
        >
          {triggerContent}
          <ChevronsUpDown
            className={cn(
              "h-4 w-4 shrink-0 opacity-50 transition-transform duration-150",
              open && "rotate-180 opacity-80"
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-[--radix-popover-trigger-width] min-w-[260px] p-0", contentClassName)}
        align={align}
        onWheel={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {prefixContent && <CommandGroup>{prefixContent({ close: () => setOpen(false) })}</CommandGroup>}
            <CommandGroup>
              {items.map((item) => {
                const key = getKey(item)
                const isSelected = value !== null && getKey(value) === key
                return (
                  <CommandItem key={key} value={key} keywords={getKeywords(item)} onSelect={() => handleSelect(item)}>
                    {renderItem(item, isSelected)}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
