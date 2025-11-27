import type { Pane, Tab, Stream } from "../../types"

// ============================================================================
// URL State Serialization
// ============================================================================
// URL format: ?p=s:general,s:stream_123|a:activity
// - Pipes (|) separate panes
// - Commas (,) separate tabs within a pane (first tab is active)
// - Colons (:) separate type:slug

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
          if (tab.type === "stream") {
            // Use slug if available and valid, otherwise ID
            const slug = tab.data?.streamSlug
            const id = tab.data?.streamId

            // Check if slug is a valid string (not JSON or object)
            const isValidSlug =
              typeof slug === "string" && slug.length > 0 && !slug.startsWith("{") && !slug.startsWith("[")

            // Use slug if valid, otherwise fall back to ID
            const value = isValidSlug ? slug : typeof id === "string" ? id : ""

            return value ? `s:${value}` : ""
          } else if (tab.type === "activity") {
            // Include the active sub-tab (unread or all)
            const subTab = tab.data?.subTab || "unread"
            return `a:${subTab}`
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

export function deserializePanesFromUrl(param: string, streams: Stream[]): Pane[] | null {
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

            if (parts[0] === "s" && parts[1]) {
              // Stream: s:slug or s:streamId
              const streamSlugOrId = parts[1]

              // Skip invalid slugs (malformed JSON, etc.)
              if (streamSlugOrId.startsWith("{") || streamSlugOrId.startsWith("[")) {
                return null
              }

              const stream = streams.find((s) => s.slug === streamSlugOrId || s.id === streamSlugOrId)
              const isThread = stream?.streamType === "thread"
              return {
                id: `stream-${paneIndex}-${tabIndex}`,
                title: stream
                  ? isThread
                    ? "Thread"
                    : `#${(stream.name || "").replace("#", "")}`
                  : `#${streamSlugOrId}`,
                type: "stream",
                data: { streamSlug: stream?.slug || streamSlugOrId, streamId: stream?.id },
              } as Tab
            } else if (parts[0] === "a") {
              // Activity: a:unread or a:all
              const subTab = parts[1] === "all" ? "all" : "unread"
              return {
                id: `activity-${paneIndex}-${tabIndex}`,
                title: "Activity",
                type: "activity",
                data: { subTab },
              } as Tab
            }
            return null
          })
          .filter((t): t is Tab => t !== null)

        if (tabs.length === 0) return null

        const firstTab = tabs[0]
        if (!firstTab) return null

        return {
          id: `pane-${paneIndex}`,
          tabs,
          activeTabId: firstTab.id, // First tab is active
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
  if (item.type === "stream") {
    // Ensure we only serialize strings, not objects
    const slug = item.data?.streamSlug
    const id = item.data?.streamId
    const value = (typeof slug === "string" ? slug : null) || (typeof id === "string" ? id : null) || ""
    if (value && !value.startsWith("{") && !value.startsWith("[")) {
      url.searchParams.set("p", `s:${value}`)
    }
  } else if (item.type === "activity") {
    const subTab = item.data?.subTab || "unread"
    url.searchParams.set("p", `a:${subTab}`)
  }
  return url.toString()
}
