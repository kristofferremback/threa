import { useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import type { QuickSwitcherMode } from "./quick-switcher"

interface ModeTabsProps {
  currentMode: QuickSwitcherMode
  onModeChange: (mode: QuickSwitcherMode) => void
  focusedTabIndex: number | null
  onFocusedTabIndexChange: (index: number | null) => void
  onTabSelect: () => void
}

const MODES: { mode: QuickSwitcherMode; label: string; shortcut: string | null }[] = [
  { mode: "stream", label: "Stream search", shortcut: null },
  { mode: "command", label: "Command palette", shortcut: ">" },
  { mode: "search", label: "Message search", shortcut: "?" },
]

export function ModeTabs({
  currentMode,
  onModeChange,
  focusedTabIndex,
  onFocusedTabIndexChange,
  onTabSelect,
}: ModeTabsProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Focus the tab when focusedTabIndex changes
  useEffect(() => {
    if (focusedTabIndex !== null && tabRefs.current[focusedTabIndex]) {
      tabRefs.current[focusedTabIndex]?.focus()
    }
  }, [focusedTabIndex])

  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Tab" && !e.shiftKey) {
      // Tab cycles through tabs, then back to input
      e.preventDefault()
      const nextIndex = (index + 1) % MODES.length
      if (nextIndex === 0) {
        // Cycled back to start - return to input
        onFocusedTabIndexChange(null)
        onTabSelect()
      } else {
        onFocusedTabIndexChange(nextIndex)
      }
    } else if (e.key === "Tab" && e.shiftKey) {
      // Shift+Tab goes back through tabs, then to input
      e.preventDefault()
      if (index === 0) {
        onFocusedTabIndexChange(null)
        onTabSelect()
      } else {
        onFocusedTabIndexChange(index - 1)
      }
    } else if (e.key === "ArrowRight") {
      e.preventDefault()
      const nextIndex = (index + 1) % MODES.length
      onFocusedTabIndexChange(nextIndex)
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      const prevIndex = (index - 1 + MODES.length) % MODES.length
      onFocusedTabIndexChange(prevIndex)
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      const mode = MODES[index].mode
      onModeChange(mode)
      onTabSelect()
    } else if (e.key === "Escape") {
      e.preventDefault()
      onFocusedTabIndexChange(null)
      onTabSelect()
    }
  }

  const handleTabClick = (mode: QuickSwitcherMode) => {
    onModeChange(mode)
    onFocusedTabIndexChange(null)
    onTabSelect()
  }

  return (
    <div className="flex" role="tablist" aria-label="Quick switcher modes">
      {MODES.map(({ mode, label, shortcut }, index) => {
        const isSelected = mode === currentMode
        const isFocused = focusedTabIndex === index

        return (
          <button
            key={mode}
            ref={(el) => {
              tabRefs.current[index] = el
            }}
            role="tab"
            aria-selected={isSelected}
            tabIndex={isFocused ? 0 : -1}
            onClick={() => handleTabClick(mode)}
            onKeyDown={(e) => handleTabKeyDown(e, index)}
            onFocus={() => onFocusedTabIndexChange(index)}
            onBlur={() => {
              // Only clear if we're not moving to another tab
              requestAnimationFrame(() => {
                const activeElement = document.activeElement
                const isTabFocused = tabRefs.current.some((ref) => ref === activeElement)
                if (!isTabFocused) {
                  onFocusedTabIndexChange(null)
                }
              })
            }}
            className={cn(
              "flex-1 px-3 py-2 text-xs font-medium transition-colors border-b-2",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              isSelected
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
          >
            {shortcut && <span className="text-muted-foreground mr-1">({shortcut})</span>}
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** Get the index of the next unselected tab for Tab key navigation */
export function getNextUnselectedTabIndex(currentMode: QuickSwitcherMode): number {
  const currentIndex = MODES.findIndex((m) => m.mode === currentMode)
  // Return the next tab (wrapping around), but skip the current one
  for (let i = 1; i < MODES.length; i++) {
    const nextIndex = (currentIndex + i) % MODES.length
    if (MODES[nextIndex].mode !== currentMode) {
      return nextIndex
    }
  }
  return (currentIndex + 1) % MODES.length
}
