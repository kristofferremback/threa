import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react"
import { useSearchParams, useLocation } from "react-router-dom"

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
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const [draftContent, setDraftContentState] = useState("")

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

  // Parse draft from URL (format: parentStreamId:parentMessageId)
  const draftReply = useMemo(() => {
    const draftParam = searchParams.get("draft")
    if (!draftParam) return null
    const [parentStreamId, parentMessageId] = draftParam.split(":")
    if (!parentStreamId || !parentMessageId) return null
    return { parentStreamId, parentMessageId, content: draftContent }
  }, [searchParams, draftContent])

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
          next.append("panel", streamId)
          // Clear draft if we're opening the thread for our draft
          if (parentInfo?.parentMessageId) {
            const draftParam = next.get("draft")
            if (draftParam?.includes(parentInfo.parentMessageId)) {
              next.delete("draft")
              setDraftContentState("")
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
      const currentPanels = searchParams.getAll("panel")
      const index = currentPanels.indexOf(streamId)
      if (index === -1) return

      // Close this panel and all nested ones (those after it in the array)
      const newPanels = currentPanels.slice(0, index)

      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete("panel")
          for (const panel of newPanels) {
            next.append("panel", panel)
          }
          return next
        },
        { replace: true }
      )
    },
    [searchParams, setSearchParams]
  )

  const closeAllPanels = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete("panel")
        next.delete("draft")
        return next
      },
      { replace: true }
    )
    setDraftContentState("")
  }, [setSearchParams])

  const setDraftContent = useCallback((content: string) => {
    setDraftContentState(content)
  }, [])

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
      setDraftContentState("")
    },
    [setSearchParams]
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
