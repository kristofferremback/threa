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

export const SETTINGS_DIALOG_LAYOUT_CLASSNAMES = {
  tabs: "flex min-h-0 flex-1 flex-col",
  panels: "flex min-h-0 flex-1 flex-col overflow-hidden sm:grid sm:grid-cols-[220px,minmax(0,1fr)]",
  content: "flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-4 scrollbar-thin sm:px-6 sm:py-6",
} as const

export function ResponsiveSettingsNav<T extends string>({
  tabs,
  items,
  value,
  onValueChange,
}: ResponsiveSettingsNavProps<T>) {
  const labels = Object.fromEntries(tabs.map((tab) => [tab, items[tab].label])) as Record<T, string>

  return (
    <ResponsiveTabs tabs={tabs} labels={labels} value={value} onValueChange={onValueChange}>
      <div
        data-slot="settings-nav"
        className="hidden h-full min-h-0 flex-col overflow-y-auto border-r bg-muted/20 p-3 scrollbar-thin sm:flex"
      >
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
