import type { Pane, Tab, Channel } from "../../types"

// ============================================================================
// URL State Serialization
// ============================================================================
// URL format: ?p=channel:general,thread:msg_123:general|thread:msg_456:general
// - Pipes (|) separate panes
// - Commas (,) separate tabs within a pane (first tab is active)
// - Colons (:) separate type:id:channelId

export function serializePanesToUrl(panes: Pane[]): string {
  if (panes.length === 0) return ""

  const serialized = panes
    .map((pane) => {
      // Put active tab first
      const sortedTabs = [...pane.tabs].sort((a, b) => {
        if (a.id === pane.activeTabId) return -1
        if (b.id === pane.activeTabId) return 1
        return 0
      })

      return sortedTabs
        .map((tab) => {
          if (tab.type === "channel") {
            return `c:${tab.data?.channelId || ""}`
          } else if (tab.type === "thread") {
            return `t:${tab.data?.threadId || ""}:${tab.data?.channelId || ""}`
          }
          return ""
        })
        .filter(Boolean)
        .join(",")
    })
    .filter(Boolean)
    .join("|")

  return serialized
}

export function deserializePanesFromUrl(param: string, channels: Channel[]): Pane[] | null {
  if (!param) return null

  try {
    const paneStrings = param.split("|").filter(Boolean)
    if (paneStrings.length === 0) return null

    const panes: Pane[] = paneStrings
      .map((paneStr, paneIndex) => {
        const tabStrings = paneStr.split(",").filter(Boolean)
        const tabs: Tab[] = tabStrings
          .map((tabStr, tabIndex) => {
            const parts = tabStr.split(":")

            if (parts[0] === "c" && parts[1]) {
              // Channel: c:slug
              const channelSlug = parts[1]
              const channel = channels.find((c) => c.slug === channelSlug)
              return {
                id: `channel-${paneIndex}-${tabIndex}`,
                title: channel ? `#${channel.name.replace("#", "")}` : `#${channelSlug}`,
                type: "channel" as const,
                data: { channelId: channelSlug },
              }
            } else if (parts[0] === "t" && parts[1]) {
              // Thread: t:threadId:channelId
              const threadId = parts[1]
              const channelId = parts[2] || ""
              return {
                id: `thread-${paneIndex}-${tabIndex}`,
                title: "Thread",
                type: "thread" as const,
                data: { threadId, channelId },
              }
            }
            return null
          })
          .filter((t): t is Tab => t !== null)

        if (tabs.length === 0) return null

        return {
          id: `pane-${paneIndex}`,
          tabs,
          activeTabId: tabs[0].id, // First tab is active
        }
      })
      .filter((p): p is Pane => p !== null)

    return panes.length > 0 ? panes : null
  } catch {
    return null
  }
}

export function updateUrlWithPanes(panes: Pane[], pushHistory = false) {
  const serialized = serializePanesToUrl(panes)
  const url = new URL(window.location.href)

  if (serialized) {
    url.searchParams.set("p", serialized)
  } else {
    url.searchParams.delete("p")
  }

  // Use pushState for navigation actions, replaceState for minor updates
  if (pushHistory) {
    window.history.pushState({ panes: serialized }, "", url.toString())
  } else {
    window.history.replaceState({ panes: serialized }, "", url.toString())
  }
}

export function buildNewTabUrl(item: Omit<Tab, "id">): string {
  const url = new URL(window.location.origin)
  if (item.type === "thread" && item.data?.threadId) {
    url.searchParams.set("p", `t:${item.data.threadId}:${item.data.channelId || ""}`)
  } else if (item.type === "channel" && item.data?.channelId) {
    url.searchParams.set("p", `c:${item.data.channelId}`)
  }
  return url.toString()
}
