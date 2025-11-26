import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"

export type Theme = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  isDark: boolean
  isLight: boolean
  isSystem: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const THEME_STORAGE_KEY = "threa-theme"

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system"
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored
  }
  return "system"
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") {
    return getSystemTheme()
  }
  return theme
}

function applyTheme(resolvedTheme: ResolvedTheme) {
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(resolvedTheme)
  root.style.colorScheme = resolvedTheme
}

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(getStoredTheme()))

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    localStorage.setItem(THEME_STORAGE_KEY, newTheme)
    const resolved = resolveTheme(newTheme)
    setResolvedTheme(resolved)
    applyTheme(resolved)
  }, [])

  useEffect(() => {
    const resolved = resolveTheme(theme)
    setResolvedTheme(resolved)
    applyTheme(resolved)
  }, [theme])

  useEffect(() => {
    if (theme !== "system") return

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => {
      const resolved = getSystemTheme()
      setResolvedTheme(resolved)
      applyTheme(resolved)
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [theme])

  const toggleTheme = useCallback(() => {
    const nextTheme: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light"
    setTheme(nextTheme)
  }, [theme, setTheme])

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme,
        toggleTheme,
        isDark: resolvedTheme === "dark",
        isLight: resolvedTheme === "light",
        isSystem: theme === "system",
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}
