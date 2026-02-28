import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { TabsList, TabsTrigger } from "./tabs"
import { cn } from "@/lib/utils"

interface ResponsiveTabsProps<T extends string> {
  tabs: readonly T[]
  labels: Record<T, string>
  value: T
  onValueChange: (value: T) => void
  /** Number of columns for the desktop grid (defaults to tabs.length) */
  columns?: number
}

/**
 * Mobile: Shadcn Select dropdown. Desktop: TabsList grid.
 * Must be rendered inside a Radix Tabs root.
 */
export function ResponsiveTabs<T extends string>({
  tabs,
  labels,
  value,
  onValueChange,
  columns,
}: ResponsiveTabsProps<T>) {
  const cols = columns ?? tabs.length

  return (
    <>
      {/* Mobile: Shadcn Select dropdown */}
      <div className="sm:hidden">
        <Select value={value} onValueChange={(v) => onValueChange(v as T)}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tabs.map((tab) => (
              <SelectItem key={tab} value={tab}>
                {labels[tab]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* Desktop: tab grid */}
      <TabsList
        className={cn(
          "hidden sm:grid w-full",
          cols === 1 && "grid-cols-1",
          cols === 2 && "grid-cols-2",
          cols === 3 && "grid-cols-3",
          cols === 4 && "grid-cols-4",
          cols === 5 && "grid-cols-5",
          cols === 6 && "grid-cols-6"
        )}
      >
        {tabs.map((tab) => (
          <TabsTrigger key={tab} value={tab}>
            {labels[tab]}
          </TabsTrigger>
        ))}
      </TabsList>
    </>
  )
}
