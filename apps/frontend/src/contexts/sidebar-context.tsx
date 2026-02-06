import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react"

/**
 * Sidebar states:
 * - collapsed: 6px color strip only, content hidden
 * - preview: user-defined width, positioned absolutely (doesn't push content), triggered by hover
 * - pinned: user-defined width, positioned normally (pushes main content)
 */
type SidebarState = "collapsed" | "preview" | "pinned"

/** Simplified open state for persistence (preview is transient) */
type SidebarOpenState = "open" | "collapsed"

type ViewMode = "smart" | "all"

/** Urgency block for position-matched collapsed strip */
interface UrgencyBlock {
  /** Position as fraction of total list height (0 to 1) */
  position: number
  /** Height as fraction of total list height */
  height: number
  /** CSS color for this urgency level */
  color: string
  /** Opacity for fade transitions (0-1) */
  opacity: number
}

/** Persisted sidebar state (single localStorage key) */
interface SidebarPersistedState {
  openState: SidebarOpenState
  width: number
  viewMode: ViewMode
  collapsedSections: string[]
}

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 400
const DEFAULT_SIDEBAR_WIDTH = 260
const SIDEBAR_STATE_KEY = "threa-sidebar-state"
const MOBILE_BREAKPOINT = 640

const DEFAULT_PERSISTED_STATE: SidebarPersistedState = {
  openState: "open",
  width: DEFAULT_SIDEBAR_WIDTH,
  viewMode: "smart",
  collapsedSections: ["other"],
}

interface SidebarContextValue {
  /** Current sidebar state */
  state: SidebarState
  /** Current sidebar width in pixels */
  width: number
  /** Current view mode (smart/all) */
  viewMode: ViewMode
  /** Currently collapsed sections */
  collapsedSections: string[]
  /** Whether viewport is mobile-sized */
  isMobile: boolean
  /** Whether sidebar is currently being hovered (for hover margin behavior) */
  isHovering: boolean
  /** Whether sidebar is currently being resized */
  isResizing: boolean
  /** Position-matched urgency blocks for collapsed strip */
  urgencyBlocks: Map<string, UrgencyBlock>
  /** Total height of sidebar (for position calculations) */
  sidebarHeight: number
  /** Offset from sidebar top to scroll container top (header + quick links) */
  scrollContainerOffset: number
  /** Show preview state on hover (only from collapsed) */
  showPreview: () => void
  /** Hide preview state after delay */
  hidePreview: () => void
  /** Toggle between collapsed and pinned */
  togglePinned: () => void
  /** Collapse the sidebar (from pinned) */
  collapse: () => void
  /** Set hovering state */
  setHovering: (hovering: boolean) => void
  /** Start resizing */
  startResizing: () => void
  /** Stop resizing */
  stopResizing: () => void
  /** Set sidebar width */
  setWidth: (width: number) => void
  /** Set view mode */
  setViewMode: (mode: ViewMode) => void
  /** Toggle a section's collapsed state */
  toggleSectionCollapsed: (section: string) => void
  /** Set urgency block for a stream item (opacity is added automatically) */
  setUrgencyBlock: (streamId: string, block: Omit<UrgencyBlock, "opacity"> | null) => void
  /** Set sidebar height */
  setSidebarHeight: (height: number) => void
  /** Set scroll container offset from sidebar top */
  setScrollContainerOffset: (offset: number) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

const HIDE_DELAY_MS = 150

interface SidebarProviderProps {
  children: ReactNode
}

function getStoredState(): SidebarPersistedState {
  try {
    const stored = localStorage.getItem(SIDEBAR_STATE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<SidebarPersistedState>
      return {
        openState: parsed.openState === "collapsed" ? "collapsed" : "open",
        width:
          typeof parsed.width === "number" && parsed.width >= MIN_SIDEBAR_WIDTH && parsed.width <= MAX_SIDEBAR_WIDTH
            ? parsed.width
            : DEFAULT_PERSISTED_STATE.width,
        viewMode: parsed.viewMode === "all" ? "all" : "smart",
        collapsedSections: Array.isArray(parsed.collapsedSections)
          ? parsed.collapsedSections
          : DEFAULT_PERSISTED_STATE.collapsedSections,
      }
    }
  } catch {
    // localStorage not available or invalid JSON
  }
  return DEFAULT_PERSISTED_STATE
}

function storeState(state: SidebarPersistedState): void {
  try {
    localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify(state))
  } catch {
    // localStorage not available
  }
}

export function SidebarProvider({ children }: SidebarProviderProps) {
  // Load persisted state on mount
  const [persistedState, setPersistedState] = useState<SidebarPersistedState>(getStoredState)

  // Runtime state (preview is transient, not persisted)
  const [state, setState] = useState<SidebarState>(() =>
    persistedState.openState === "collapsed" ? "collapsed" : "pinned"
  )
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT)
  const [isHovering, setIsHovering] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [urgencyBlocks, setUrgencyBlocks] = useState<Map<string, UrgencyBlock>>(new Map())
  const [sidebarHeight, setSidebarHeight] = useState(0)
  const [scrollContainerOffset, setScrollContainerOffset] = useState(0)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeOutTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Persist state changes
  const updatePersistedState = useCallback((updates: Partial<SidebarPersistedState>) => {
    setPersistedState((current) => {
      const next = { ...current, ...updates }
      storeState(next)
      return next
    })
  }, [])

  // Track viewport size for mobile responsiveness
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT
      setIsMobile(mobile)
      // Auto-collapse when transitioning to mobile
      if (mobile) {
        setState("collapsed")
      }
    }

    window.addEventListener("resize", handleResize)
    // Initial check
    handleResize()

    return () => window.removeEventListener("resize", handleResize)
  }, [])

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

  // Toggle between collapsed and pinned (or preview on mobile)
  const togglePinned = useCallback(() => {
    clearHideTimeout()
    setState((current) => {
      const next = current === "pinned" || current === "preview" ? "collapsed" : isMobile ? "preview" : "pinned"
      // Persist the open state (not preview which is transient)
      if (!isMobile) {
        updatePersistedState({ openState: next === "pinned" ? "open" : "collapsed" })
      }
      return next
    })
  }, [clearHideTimeout, isMobile, updatePersistedState])

  // Collapse the sidebar
  const collapse = useCallback(() => {
    clearHideTimeout()
    setState("collapsed")
    updatePersistedState({ openState: "collapsed" })
  }, [clearHideTimeout, updatePersistedState])

  // Track hovering state (don't hide when resizing - user may drag outside sidebar)
  const setHovering = useCallback(
    (hovering: boolean) => {
      setIsHovering(hovering)
      if (hovering) {
        showPreview()
      } else if (!isResizing) {
        hidePreview()
      }
    },
    [showPreview, hidePreview, isResizing]
  )

  // Resize functions
  const startResizing = useCallback(() => {
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const setWidth = useCallback(
    (newWidth: number) => {
      // Resize-to-minimize: if dragged small enough, collapse instead
      const collapseThreshold = MIN_SIDEBAR_WIDTH - 50

      // If dragging back up from collapsed state, re-expand
      setState((currentState) => {
        if (currentState === "collapsed" && newWidth >= MIN_SIDEBAR_WIDTH) {
          updatePersistedState({ openState: "open" })
          return "pinned"
        }
        if (currentState !== "collapsed" && newWidth < collapseThreshold) {
          updatePersistedState({ openState: "collapsed" })
          return "collapsed"
        }
        return currentState
      })

      // Update width if above minimum
      if (newWidth >= MIN_SIDEBAR_WIDTH) {
        const clampedWidth = Math.min(MAX_SIDEBAR_WIDTH, newWidth)
        updatePersistedState({ width: clampedWidth })
      }
    },
    [updatePersistedState]
  )

  // View mode
  const setViewMode = useCallback(
    (mode: ViewMode) => {
      updatePersistedState({ viewMode: mode })
    },
    [updatePersistedState]
  )

  // Section collapse state
  const toggleSectionCollapsed = useCallback((section: string) => {
    setPersistedState((current) => {
      const isCollapsed = current.collapsedSections.includes(section)
      const next = {
        ...current,
        collapsedSections: isCollapsed
          ? current.collapsedSections.filter((s) => s !== section)
          : [...current.collapsedSections, section],
      }
      storeState(next)
      return next
    })
  }, [])

  // Urgency block registration for position-matched strip with fade transitions
  const setUrgencyBlock = useCallback((streamId: string, block: Omit<UrgencyBlock, "opacity"> | null) => {
    // Clear any existing fade-out timeout for this stream
    const existingTimeout = fadeOutTimeoutsRef.current.get(streamId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      fadeOutTimeoutsRef.current.delete(streamId)
    }

    if (block === null) {
      // Fade out: set opacity to 0, then remove after transition
      setUrgencyBlocks((current) => {
        const existing = current.get(streamId)
        if (!existing) return current

        const next = new Map(current)
        next.set(streamId, { ...existing, opacity: 0 })
        return next
      })

      // Schedule removal after fade transition completes
      const timeout = setTimeout(() => {
        setUrgencyBlocks((current) => {
          const next = new Map(current)
          next.delete(streamId)
          return next
        })
        fadeOutTimeoutsRef.current.delete(streamId)
      }, 300)
      fadeOutTimeoutsRef.current.set(streamId, timeout)
    } else {
      // Fade in: set block with full opacity
      setUrgencyBlocks((current) => {
        const next = new Map(current)
        next.set(streamId, { ...block, opacity: 1 })
        return next
      })
    }
  }, [])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
      // Clean up all fade-out timeouts
      fadeOutTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
      fadeOutTimeoutsRef.current.clear()
    }
  }, [])

  return (
    <SidebarContext.Provider
      value={{
        state,
        width: persistedState.width,
        viewMode: persistedState.viewMode,
        collapsedSections: persistedState.collapsedSections,
        isMobile,
        isHovering,
        isResizing,
        urgencyBlocks,
        sidebarHeight,
        scrollContainerOffset,
        showPreview,
        hidePreview,
        togglePinned,
        collapse,
        setHovering,
        startResizing,
        stopResizing,
        setWidth,
        setViewMode,
        toggleSectionCollapsed,
        setUrgencyBlock,
        setSidebarHeight,
        setScrollContainerOffset,
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

export type { ViewMode, UrgencyBlock }
