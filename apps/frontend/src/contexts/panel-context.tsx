import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react"
import { useSearchParams, useNavigate, useLocation } from "react-router-dom"

interface PanelInfo {
  streamId: string
  parentStreamId?: string
  parentMessageId?: string
}

interface DraftReply {
  parentStreamId: string
  parentMessageId: string
  content: string
}

interface PanelContextValue {
  openPanels: PanelInfo[]
  draftReply: DraftReply | null

  /** Check if a panel is already open */
  isPanelOpen: (streamId: string) => boolean
  /** Generate URL for opening a panel (for use in <a> or <Link> href) */
  getPanelUrl: (streamId: string) => string
  openPanel: (streamId: string, parentInfo?: { parentStreamId: string; parentMessageId: string }) => void
  openThreadDraft: (parentStreamId: string, parentMessageId: string) => void
  closePanel: (streamId: string) => void
  closeAllPanels: () => void
  setDraftContent: (content: string) => void
  transitionDraftToPanel: (streamId: string) => void
}

const PanelContext = createContext<PanelContextValue | null>(null)

interface PanelProviderProps {
  children: ReactNode
}

export function PanelProvider({ children }: PanelProviderProps) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [draftReply, setDraftReply] = useState<DraftReply | null>(null)

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
      // Don't navigate if panel is already open
      if (isPanelOpen(streamId)) return

      navigate(getPanelUrl(streamId), { replace: false })

      // Clear draft if we're opening the thread for our draft
      if (draftReply && parentInfo?.parentMessageId === draftReply.parentMessageId) {
        setDraftReply(null)
      }
    },
    [getPanelUrl, navigate, draftReply, isPanelOpen]
  )

  const openThreadDraft = useCallback((parentStreamId: string, parentMessageId: string) => {
    setDraftReply({
      parentStreamId,
      parentMessageId,
      content: "",
    })
  }, [])

  const closePanel = useCallback(
    (streamId: string) => {
      const currentPanels = searchParams.getAll("panel")
      const index = currentPanels.indexOf(streamId)
      if (index === -1) return

      // Close this panel and all nested ones (those after it in the array)
      const newPanels = currentPanels.slice(0, index)

      const newParams = new URLSearchParams(searchParams)
      newParams.delete("panel")
      for (const panel of newPanels) {
        newParams.append("panel", panel)
      }

      const query = newParams.toString()
      navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: false })
    },
    [searchParams, navigate, location.pathname]
  )

  const closeAllPanels = useCallback(() => {
    const newParams = new URLSearchParams(searchParams)
    newParams.delete("panel")
    const query = newParams.toString()
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: false })
    setDraftReply(null)
  }, [searchParams, navigate, location.pathname])

  const setDraftContent = useCallback((content: string) => {
    setDraftReply((prev) => (prev ? { ...prev, content } : null))
  }, [])

  const transitionDraftToPanel = useCallback(
    (streamId: string) => {
      if (!draftReply) return

      // Open the panel for the newly created thread
      const newParams = new URLSearchParams(searchParams)
      newParams.append("panel", streamId)
      navigate(`${location.pathname}?${newParams.toString()}`, { replace: false })

      // Clear the draft
      setDraftReply(null)
    },
    [draftReply, searchParams, navigate, location.pathname]
  )

  const value = useMemo<PanelContextValue>(
    () => ({
      openPanels,
      draftReply,
      isPanelOpen,
      getPanelUrl,
      openPanel,
      openThreadDraft,
      closePanel,
      closeAllPanels,
      setDraftContent,
      transitionDraftToPanel,
    }),
    [
      openPanels,
      draftReply,
      isPanelOpen,
      getPanelUrl,
      openPanel,
      openThreadDraft,
      closePanel,
      closeAllPanels,
      setDraftContent,
      transitionDraftToPanel,
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
