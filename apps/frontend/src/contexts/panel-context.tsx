import { createContext, useContext, useCallback, useMemo, type ReactNode } from "react"
import { useSearchParams, useLocation } from "react-router-dom"

/** Panel display mode */
export type PanelMode = "overlay" | "locked" | "fullscreen"

interface PanelInfo {
  streamId: string
  parentStreamId?: string
  parentMessageId?: string
}

interface DraftReply {
  parentStreamId: string
  parentMessageId: string
}

interface PanelContextValue {
  openPanels: PanelInfo[]
  draftReply: DraftReply | null
  /** Current panel mode - overlay (floating), locked (resizable), or fullscreen */
  panelMode: PanelMode
  /** Active panel index when in locked mode with tabs */
  activeTabIndex: number

  /** Check if a panel is already open */
  isPanelOpen: (streamId: string) => boolean
  /** Generate URL for opening a panel (for use in <a> or <Link> href) */
  getPanelUrl: (streamId: string) => string
  openPanel: (streamId: string, parentInfo?: { parentStreamId: string; parentMessageId: string }) => void
  openThreadDraft: (parentStreamId: string, parentMessageId: string) => void
  closePanel: (streamId: string) => void
  closeDraft: () => void
  closeAllPanels: () => void
  transitionDraftToPanel: (streamId: string) => void
  /** Pin panel to locked mode */
  pinPanel: () => void
  /** Expand panel to fullscreen */
  expandPanel: () => void
  /** Exit fullscreen mode */
  exitFullscreen: () => void
  /** Set active tab in locked mode */
  setActiveTab: (index: number) => void
}

const PanelContext = createContext<PanelContextValue | null>(null)

interface PanelProviderProps {
  children: ReactNode
}

export function PanelProvider({ children }: PanelProviderProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()

  // Parse panel mode from URL (defaults to "overlay" for single panel, "locked" for multiple)
  const panelModeParam = searchParams.get("pmode") as PanelMode | null

  // Parse open panels from URL (deduplicated)
  const openPanels = useMemo(() => {
    const panels: PanelInfo[] = []
    const seen = new Set<string>()
    const panelParams = searchParams.getAll("panel")
    for (const param of panelParams) {
      if (!seen.has(param)) {
        seen.add(param)
        panels.push({ streamId: param })
      }
    }
    return panels
  }, [searchParams])

  // Derive panel mode: fullscreen if explicitly set, otherwise always locked when panels are open
  const panelMode: PanelMode = useMemo(() => {
    if (panelModeParam === "fullscreen") return "fullscreen"
    if (panelModeParam === "locked") return "locked"
    // Auto-derive: always locked when panels are open
    return openPanels.length > 0 ? "locked" : "overlay"
  }, [panelModeParam, openPanels.length])

  // Active tab index for locked mode (URL param or default to 0)
  const activeTabIndex = useMemo(() => {
    const tabParam = searchParams.get("tab")
    if (tabParam) {
      const index = parseInt(tabParam, 10)
      if (!isNaN(index) && index >= 0 && index < openPanels.length) {
        return index
      }
    }
    return 0
  }, [searchParams, openPanels.length])

  // Parse draft from URL (format: parentStreamId:parentMessageId)
  const draftReply = useMemo(() => {
    const draftParam = searchParams.get("draft")
    if (!draftParam) return null
    const [parentStreamId, parentMessageId] = draftParam.split(":")
    if (!parentStreamId || !parentMessageId) return null
    return { parentStreamId, parentMessageId }
  }, [searchParams])

  // Check if a panel is already open
  const isPanelOpen = useCallback((streamId: string) => openPanels.some((p) => p.streamId === streamId), [openPanels])

  const getPanelUrl = useCallback(
    (streamId: string) => {
      // Don't add duplicate - return current URL if already open
      if (isPanelOpen(streamId)) {
        const query = searchParams.toString()
        return `${location.pathname}${query ? `?${query}` : ""}`
      }
      const newParams = new URLSearchParams(searchParams)
      newParams.append("panel", streamId)
      return `${location.pathname}?${newParams.toString()}`
    },
    [searchParams, location.pathname, isPanelOpen]
  )

  const openPanel = useCallback(
    (streamId: string, parentInfo?: { parentStreamId: string; parentMessageId: string }) => {
      // Don't update if panel is already open
      if (isPanelOpen(streamId)) return

      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const currentPanels = prev.getAll("panel")

          // Maximum of 3 panels (main stream + 2 thread panels)
          // If we're at the limit, close the oldest panel first
          const MAX_PANELS = 3
          if (currentPanels.length >= MAX_PANELS) {
            // Remove the first (oldest) panel
            next.delete("panel")
            for (let i = 1; i < currentPanels.length; i++) {
              next.append("panel", currentPanels[i])
            }
          }

          next.append("panel", streamId)
          // Clear draft if we're opening the thread for our draft
          if (parentInfo?.parentMessageId) {
            const draftParam = next.get("draft")
            if (draftParam?.includes(parentInfo.parentMessageId)) {
              next.delete("draft")
            }
          }
          return next
        },
        { replace: true }
      )
    },
    [isPanelOpen, setSearchParams]
  )

  const openThreadDraft = useCallback(
    (parentStreamId: string, parentMessageId: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set("draft", `${parentStreamId}:${parentMessageId}`)
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const closePanel = useCallback(
    (streamId: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const currentPanels = prev.getAll("panel")
          next.delete("panel")
          for (const panel of currentPanels) {
            if (panel !== streamId) {
              next.append("panel", panel)
            }
          }
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const closeDraft = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete("draft")
        return next
      },
      { replace: true }
    )
    setDraftContentState("")
  }, [setSearchParams])

  const closeAllPanels = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete("panel")
        next.delete("draft")
        next.delete("pmode")
        next.delete("tab")
        return next
      },
      { replace: true }
    )
  }, [setSearchParams])

  const transitionDraftToPanel = useCallback(
    (streamId: string) => {
      // Atomically remove draft and add panel
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete("draft")
          next.append("panel", streamId)
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const pinPanel = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set("pmode", "locked")
        return next
      },
      { replace: true }
    )
  }, [setSearchParams])

  const expandPanel = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set("pmode", "fullscreen")
        return next
      },
      { replace: true }
    )
  }, [setSearchParams])

  const exitFullscreen = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete("pmode")
        return next
      },
      { replace: true }
    )
  }, [setSearchParams])

  const setActiveTab = useCallback(
    (index: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (index === 0) {
            next.delete("tab")
          } else {
            next.set("tab", index.toString())
          }
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const value = useMemo<PanelContextValue>(
    () => ({
      openPanels,
      draftReply,
      panelMode,
      activeTabIndex,
      isPanelOpen,
      getPanelUrl,
      openPanel,
      openThreadDraft,
      closePanel,
      closeDraft,
      closeAllPanels,
      transitionDraftToPanel,
      pinPanel,
      expandPanel,
      exitFullscreen,
      setActiveTab,
    }),
    [
      openPanels,
      draftReply,
      panelMode,
      activeTabIndex,
      isPanelOpen,
      getPanelUrl,
      openPanel,
      openThreadDraft,
      closePanel,
      closeDraft,
      closeAllPanels,
      transitionDraftToPanel,
      pinPanel,
      expandPanel,
      exitFullscreen,
      setActiveTab,
    ]
  )

  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>
}

export function usePanel(): PanelContextValue {
  const context = useContext(PanelContext)
  if (!context) {
    throw new Error("usePanel must be used within a PanelProvider")
  }
  return context
}
