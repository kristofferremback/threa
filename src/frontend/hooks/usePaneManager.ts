import { useState, useCallback, useRef, useEffect } from "react"
import type { Pane, Tab, Channel, OpenMode } from "../types"
import { deserializePanesFromUrl, updateUrlWithPanes, buildNewTabUrl } from "../components/layout/url-state"

interface UsePaneManagerOptions {
  channels: Channel[]
  defaultChannelSlug?: string
}

interface UsePaneManagerReturn {
  panes: Pane[]
  focusedPaneId: string | null
  activeChannelSlug: string | null

  // Actions
  setFocusedPane: (paneId: string) => void
  setActiveTab: (paneId: string, tabId: string) => void
  closeTab: (paneId: string, tabId: string) => void
  selectChannel: (channel: Channel) => void
  openItem: (item: Omit<Tab, "id">, mode?: OpenMode, sourcePaneId?: string) => void

  // Initialize from URL
  initializeFromUrl: () => boolean
}

export function usePaneManager({ channels, defaultChannelSlug }: UsePaneManagerOptions): UsePaneManagerReturn {
  const [panes, setPanes] = useState<Pane[]>([])
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)
  const [activeChannelSlug, setActiveChannelSlug] = useState<string | null>(null)
  const shouldPushHistory = useRef(false)

  // Sync pane changes to URL
  useEffect(() => {
    if (panes.length > 0) {
      updateUrlWithPanes(panes, shouldPushHistory.current)
      shouldPushHistory.current = false
    }
  }, [panes])

  // Handle browser back/forward navigation
  useEffect(() => {
    if (channels.length === 0) return

    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search)
      const paneParam = urlParams.get("p")
      const restoredPanes = deserializePanesFromUrl(paneParam || "", channels)

      if (restoredPanes && restoredPanes.length > 0) {
        setPanes(restoredPanes)
        setFocusedPaneId(restoredPanes[0].id)

        const firstChannelTab = restoredPanes.flatMap((p) => p.tabs).find((t) => t.type === "channel")
        if (firstChannelTab?.data?.channelId) {
          setActiveChannelSlug(firstChannelTab.data.channelId)
        }
      }
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [channels])

  // Initialize from URL
  const initializeFromUrl = useCallback((): boolean => {
    const urlParams = new URLSearchParams(window.location.search)
    const paneParam = urlParams.get("p")
    const restoredPanes = deserializePanesFromUrl(paneParam || "", channels)

    if (restoredPanes && restoredPanes.length > 0) {
      setPanes(restoredPanes)
      setFocusedPaneId(restoredPanes[0].id)

      const firstChannelTab = restoredPanes.flatMap((p) => p.tabs).find((t) => t.type === "channel")
      if (firstChannelTab?.data?.channelId) {
        setActiveChannelSlug(firstChannelTab.data.channelId)
      }
      return true
    }

    // Initialize with default channel
    const defaultChannel = defaultChannelSlug ? channels.find((c) => c.slug === defaultChannelSlug) : channels[0]

    if (defaultChannel) {
      setActiveChannelSlug(defaultChannel.slug)
      const defaultPanes: Pane[] = [
        {
          id: "pane-0",
          tabs: [
            {
              id: defaultChannel.slug,
              title: `#${defaultChannel.name.replace("#", "")}`,
              type: "channel",
              data: { channelId: defaultChannel.slug },
            },
          ],
          activeTabId: defaultChannel.slug,
        },
      ]
      setPanes(defaultPanes)
      setFocusedPaneId("pane-0")
      updateUrlWithPanes(defaultPanes)
    }

    return false
  }, [channels, defaultChannelSlug])

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

  const selectChannel = useCallback((channel: Channel) => {
    setActiveChannelSlug(channel.slug)
    shouldPushHistory.current = true
    setPanes((prev) => {
      if (prev.length === 0) {
        return [
          {
            id: "pane-0",
            tabs: [
              {
                id: channel.slug,
                title: `#${channel.name.replace("#", "")}`,
                type: "channel",
                data: { channelId: channel.slug },
              },
            ],
            activeTabId: channel.slug,
          },
        ]
      }
      return prev.map((pane, idx) => {
        if (idx === 0) {
          const existingTab = pane.tabs.find((t) => t.data?.channelId === channel.slug)
          if (existingTab) {
            return { ...pane, activeTabId: existingTab.id }
          }
          const newTab: Tab = {
            id: channel.slug,
            title: `#${channel.name.replace("#", "")}`,
            type: "channel",
            data: { channelId: channel.slug },
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
    activeChannelSlug,
    setFocusedPane: setFocusedPaneId,
    setActiveTab,
    closeTab,
    selectChannel,
    openItem,
    initializeFromUrl,
  }
}
