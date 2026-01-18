import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react"

/**
 * Sidebar states:
 * - collapsed: 6px color strip only, content hidden
 * - preview: 260px width, positioned absolutely (doesn't push content), triggered by hover
 * - pinned: 260px width, positioned normally (pushes main content)
 */
type SidebarState = "collapsed" | "preview" | "pinned"

interface SidebarContextValue {
  /** Current sidebar state */
  state: SidebarState
  /** Whether sidebar is currently being hovered (for hover margin behavior) */
  isHovering: boolean
  /** Show preview state on hover (only from collapsed) */
  showPreview: () => void
  /** Hide preview state after delay */
  hidePreview: () => void
  /** Toggle between collapsed and pinned */
  togglePinned: () => void
  /** Pin the sidebar (from preview or collapsed) */
  pin: () => void
  /** Collapse the sidebar (from pinned) */
  collapse: () => void
  /** Set hovering state */
  setHovering: (hovering: boolean) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

const HIDE_DELAY_MS = 150

interface SidebarProviderProps {
  children: ReactNode
  /** Default state when mounting */
  defaultState?: SidebarState
}

export function SidebarProvider({ children, defaultState = "pinned" }: SidebarProviderProps) {
  const [state, setState] = useState<SidebarState>(defaultState)
  const [isHovering, setIsHovering] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending hide timeout
  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
  }, [])

  // Show preview (only from collapsed state)
  const showPreview = useCallback(() => {
    clearHideTimeout()
    setState((current) => {
      if (current === "collapsed") {
        return "preview"
      }
      return current
    })
  }, [clearHideTimeout])

  // Hide preview after delay (returns to collapsed)
  const hidePreview = useCallback(() => {
    clearHideTimeout()
    hideTimeoutRef.current = setTimeout(() => {
      setState((current) => {
        if (current === "preview") {
          return "collapsed"
        }
        return current
      })
    }, HIDE_DELAY_MS)
  }, [clearHideTimeout])

  // Toggle between collapsed and pinned
  const togglePinned = useCallback(() => {
    clearHideTimeout()
    setState((current) => {
      if (current === "pinned") {
        return "collapsed"
      }
      return "pinned"
    })
  }, [clearHideTimeout])

  // Pin the sidebar
  const pin = useCallback(() => {
    clearHideTimeout()
    setState("pinned")
  }, [clearHideTimeout])

  // Collapse the sidebar
  const collapse = useCallback(() => {
    clearHideTimeout()
    setState("collapsed")
  }, [clearHideTimeout])

  // Track hovering state
  const setHovering = useCallback(
    (hovering: boolean) => {
      setIsHovering(hovering)
      if (hovering) {
        showPreview()
      } else {
        hidePreview()
      }
    },
    [showPreview, hidePreview]
  )

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [])

  return (
    <SidebarContext.Provider
      value={{
        state,
        isHovering,
        showPreview,
        hidePreview,
        togglePinned,
        pin,
        collapse,
        setHovering,
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}
