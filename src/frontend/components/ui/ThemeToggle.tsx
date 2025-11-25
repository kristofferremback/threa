import { Sun, Moon, Monitor } from "lucide-react"
import { useTheme, type Theme } from "../../contexts/ThemeContext"

interface ThemeToggleProps {
  showLabel?: boolean
  size?: "sm" | "md"
}

const themeIcons: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

const themeLabels: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
}

export function ThemeToggle({ showLabel = false, size = "md" }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme()
  const Icon = themeIcons[theme]
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"

  return (
    <button
      onClick={toggleTheme}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors"
      style={{ color: "var(--text-secondary)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay-strong)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      title={`Theme: ${themeLabels[theme]} (click to cycle)`}
    >
      <Icon className={iconSize} />
      {showLabel && <span className="text-sm">{themeLabels[theme]}</span>}
    </button>
  )
}

interface ThemeSelectorProps {
  onSelect?: () => void
}

export function ThemeSelector({ onSelect }: ThemeSelectorProps) {
  const { theme, setTheme } = useTheme()

  const handleSelect = (newTheme: Theme) => {
    setTheme(newTheme)
    onSelect?.()
  }

  return (
    <div className="py-1">
      <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        Theme
      </div>
      {(["light", "dark", "system"] as Theme[]).map((t) => {
        const Icon = themeIcons[t]
        const isActive = theme === t
        return (
          <button
            key={t}
            onClick={(e) => {
              e.stopPropagation()
              handleSelect(t)
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
            style={{
              color: isActive ? "var(--accent-primary)" : "var(--text-secondary)",
              background: isActive ? "var(--hover-overlay)" : "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = isActive ? "var(--hover-overlay)" : "transparent")}
          >
            <Icon className="h-4 w-4" />
            <span className="text-sm">{themeLabels[t]}</span>
            {isActive && (
              <span className="ml-auto text-xs" style={{ color: "var(--accent-primary)" }}>
                ✓
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
