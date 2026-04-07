import { cn } from "@/lib/utils"
import { ResponsiveTabs } from "./responsive-tabs"

interface SettingsNavItem {
  label: string
  description?: string
}

interface ResponsiveSettingsNavProps<T extends string> {
  tabs: readonly T[]
  items: Record<T, SettingsNavItem>
  value: T
  onValueChange: (value: T) => void
}

export function ResponsiveSettingsNav<T extends string>({
  tabs,
  items,
  value,
  onValueChange,
}: ResponsiveSettingsNavProps<T>) {
  const labels = Object.fromEntries(tabs.map((tab) => [tab, items[tab].label])) as Record<T, string>

  return (
    <ResponsiveTabs tabs={tabs} labels={labels} value={value} onValueChange={onValueChange}>
      <div className="hidden sm:flex h-full flex-col border-r bg-muted/20 p-3">
        {tabs.map((tab) => {
          const item = items[tab]
          const isActive = tab === value

          return (
            <button
              key={tab}
              type="button"
              onClick={() => onValueChange(tab)}
              className={cn(
                "rounded-xl px-3 py-2.5 text-left transition-colors",
                isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/70"
              )}
            >
              <div className="text-sm font-medium">{item.label}</div>
              {item.description ? <div className="mt-0.5 text-xs">{item.description}</div> : null}
            </button>
          )
        })}
      </div>
    </ResponsiveTabs>
  )
}
