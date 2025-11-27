import { useState, useCallback, useRef, useEffect } from "react"
import type { Pane, Tab, Stream, OpenMode } from "../types"
import { deserializePanesFromUrl, updateUrlWithPanes, buildNewTabUrl } from "../components/layout/url-state"

interface UsePaneManagerOptions {
  streams: Stream[]
  defaultStreamSlug?: string
}

interface UsePaneManagerReturn {
  panes: Pane[]
  focusedPaneId: string | null
  activeStreamSlug: string | null

  // Actions
  setFocusedPane: (paneId: string) => void
  setActiveTab: (paneId: string, tabId: string) => void
  closeTab: (paneId: string, tabId: string) => void
  selectStream: (stream: Stream) => void
  openItem: (item: Omit<Tab, "id">, mode?: OpenMode, sourcePaneId?: string) => void

  // Initialize from URL
  initializeFromUrl: () => boolean
}

export function usePaneManager({ streams, defaultStreamSlug }: UsePaneManagerOptions): UsePaneManagerReturn {
  const [panes, setPanes] = useState<Pane[]>([])
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)
  const [activeStreamSlug, setActiveStreamSlug] = useState<string | null>(null)
  const shouldPushHistory = useRef(false)
  const hasInitialized = useRef(false)

  // Sync pane changes to URL
  useEffect(() => {
    if (panes.length > 0) {
      updateUrlWithPanes(panes, shouldPushHistory.current)
      shouldPushHistory.current = false
    }
  }, [panes])

  // Handle browser back/forward navigation
  useEffect(() => {
    if (streams.length === 0) return

    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search)
      const paneParam = urlParams.get("p")
      const restoredPanes = deserializePanesFromUrl(paneParam || "", streams)

      if (restoredPanes && restoredPanes.length > 0) {
        setPanes(restoredPanes)
        setFocusedPaneId(restoredPanes[0].id)

        const firstStreamTab = restoredPanes.flatMap((p) => p.tabs).find((t) => t.type === "stream")
        if (firstStreamTab?.data?.streamSlug || firstStreamTab?.data?.streamId) {
          setActiveStreamSlug(firstStreamTab.data.streamSlug || firstStreamTab.data.streamId || null)
        }
      }
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [streams])

  // Initialize from URL - only runs once
  const initializeFromUrl = useCallback((): boolean => {
    // Only initialize once
    if (hasInitialized.current) {
      return false
    }

    // Need streams to be loaded
    if (streams.length === 0) {
      return false
    }

    hasInitialized.current = true

    const urlParams = new URLSearchParams(window.location.search)
    const paneParam = urlParams.get("p")
    const restoredPanes = deserializePanesFromUrl(paneParam || "", streams)

    if (restoredPanes && restoredPanes.length > 0) {
      setPanes(restoredPanes)
      setFocusedPaneId(restoredPanes[0].id)

      const firstStreamTab = restoredPanes.flatMap((p) => p.tabs).find((t) => t.type === "stream")
      if (firstStreamTab?.data?.streamSlug) {
        setActiveStreamSlug(firstStreamTab.data.streamSlug)
      }
      return true
    }

    // Initialize with default stream (first channel)
    const defaultStream =
      defaultStreamSlug
        ? streams.find((s) => s.slug === defaultStreamSlug)
        : streams.find((s) => s.streamType === "channel" && s.isMember)

    if (defaultStream) {
      setActiveStreamSlug(defaultStream.slug)
      const defaultPanes: Pane[] = [
        {
          id: "pane-0",
          tabs: [
            {
              id: defaultStream.slug || defaultStream.id,
              title: `#${(defaultStream.name || "").replace("#", "")}`,
              type: "stream",
              data: { streamSlug: defaultStream.slug || undefined, streamId: defaultStream.id },
            },
          ],
          activeTabId: defaultStream.slug || defaultStream.id,
        },
      ]
      setPanes(defaultPanes)
      setFocusedPaneId("pane-0")
      updateUrlWithPanes(defaultPanes)
    }

    return false
  }, [streams, defaultStreamSlug])

  // Open item in a new pane to the side of the source pane
  const openItemToSide = useCallback(
    (item: Omit<Tab, "id">, sourcePaneId?: string) => {
      shouldPushHistory.current = true
      setPanes((prev) => {
        // Use sourcePaneId if provided, otherwise fall back to focusedPaneId
        const targetPaneId = sourcePaneId || focusedPaneId
        const sourceIndex = prev.findIndex((p) => p.id === targetPaneId)
        if (sourceIndex === -1) return prev

        const targetIndex = sourceIndex + 1
        const newTabId = `${item.type}-${Date.now()}`
        const newTab: Tab = { ...item, id: newTabId }

        if (targetIndex < prev.length) {
          // Add to existing pane on the right
          return prev.map((pane, index) => {
            if (index === targetIndex) {
              return { ...pane, tabs: [...pane.tabs, newTab], activeTabId: newTabId }
            }
            return pane
          })
        }

        // Create new pane
        const newPaneId = `pane-${Date.now()}`
        return [...prev, { id: newPaneId, tabs: [newTab], activeTabId: newTabId }]
      })
    },
    [focusedPaneId],
  )

  // Replace current tab in the source pane
  const openItemInPlace = useCallback(
    (item: Omit<Tab, "id">, sourcePaneId?: string) => {
      shouldPushHistory.current = true
      setPanes((prev) => {
        // Use sourcePaneId if provided, otherwise fall back to focusedPaneId
        const targetPaneId = sourcePaneId || focusedPaneId
        const sourceIndex = prev.findIndex((p) => p.id === targetPaneId)
        if (sourceIndex === -1) return prev

        const newTabId = `${item.type}-${Date.now()}`
        const newTab: Tab = { ...item, id: newTabId }

        return prev.map((pane, index) => {
          if (index === sourceIndex) {
            const newTabs = pane.tabs.map((tab) => (tab.id === pane.activeTabId ? newTab : tab))
            return { ...pane, tabs: newTabs, activeTabId: newTabId }
          }
          return pane
        })
      })
    },
    [focusedPaneId],
  )

  // Open item based on mode, optionally specifying which pane initiated the action
  const openItem = useCallback(
    (item: Omit<Tab, "id">, mode: OpenMode = "side", sourcePaneId?: string) => {
      if (mode === "newTab") {
        window.open(buildNewTabUrl(item), "_blank")
        return
      }

      if (mode === "replace") {
        openItemInPlace(item, sourcePaneId)
      } else {
        openItemToSide(item, sourcePaneId)
      }
    },
    [openItemInPlace, openItemToSide],
  )

  const closeTab = useCallback((paneId: string, tabId: string) => {
    setPanes((prev) => {
      const newPanes = prev
        .map((pane) => {
          if (pane.id !== paneId) return pane
          const newTabs = pane.tabs.filter((t) => t.id !== tabId)
          let newActiveId = pane.activeTabId
          if (tabId === pane.activeTabId && newTabs.length > 0) {
            newActiveId = newTabs[newTabs.length - 1].id
          }
          return { ...pane, tabs: newTabs, activeTabId: newActiveId }
        })
        .filter((pane) => pane.tabs.length > 0)
      return newPanes
    })
  }, [])

  const setActiveTab = useCallback((paneId: string, tabId: string) => {
    setPanes((prev) => prev.map((p) => (p.id === paneId ? { ...p, activeTabId: tabId } : p)))
    setFocusedPaneId(paneId)
  }, [])

  const selectStream = useCallback((stream: Stream) => {
    setActiveStreamSlug(stream.slug)
    shouldPushHistory.current = true
    setPanes((prev) => {
      if (prev.length === 0) {
        return [
          {
            id: "pane-0",
            tabs: [
              {
                id: stream.slug || stream.id,
                title: `#${(stream.name || "").replace("#", "")}`,
                type: "stream",
                data: { streamSlug: stream.slug || undefined, streamId: stream.id },
              },
            ],
            activeTabId: stream.slug || stream.id,
          },
        ]
      }
      return prev.map((pane, idx) => {
        if (idx === 0) {
          const existingTab = pane.tabs.find((t) => t.data?.streamSlug === stream.slug || t.data?.streamId === stream.id)
          if (existingTab) {
            return { ...pane, activeTabId: existingTab.id }
          }
          const newTab: Tab = {
            id: stream.slug || stream.id,
            title: `#${(stream.name || "").replace("#", "")}`,
            type: "stream",
            data: { streamSlug: stream.slug || undefined, streamId: stream.id },
          }
          return { ...pane, tabs: [newTab, ...pane.tabs.slice(1)], activeTabId: newTab.id }
        }
        return pane
      })
    })
  }, [])

  return {
    panes,
    focusedPaneId,
    activeStreamSlug,
    setFocusedPane: setFocusedPaneId,
    setActiveTab,
    closeTab,
    selectStream,
    openItem,
    initializeFromUrl,
  }
}
