import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { workspaceKeys } from "./use-workspaces"
import type { WorkspaceBootstrap } from "@threa/types"

const BASE_TITLE = "Threa"

const DARK_FAVICON_SVG = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M 50 24 C 64 30, 72 42, 72 50 C 72 58, 64 70, 50 76 C 36 70, 28 58, 28 50 C 28 42, 36 30, 50 24 Z"
        stroke="#C8A055" stroke-width="5" fill="none"/>
  <path d="M 50 14 C 47 26, 46 38, 50 50 C 54 62, 53 74, 50 86"
        stroke="#C8A055" stroke-width="6" stroke-linecap="round" fill="none"/>
</svg>`

const LIGHT_FAVICON_SVG = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M 50 24 C 64 30, 72 42, 72 50 C 72 58, 64 70, 50 76 C 36 70, 28 58, 28 50 C 28 42, 36 30, 50 24 Z"
        stroke="#8B7332" stroke-width="5" fill="none"/>
  <path d="M 50 14 C 47 26, 46 38, 50 50 C 54 62, 53 74, 50 86"
        stroke="#8B7332" stroke-width="6" stroke-linecap="round" fill="none"/>
</svg>`

function addNotificationDot(baseSvg: string): string {
  const dot = `<circle cx="78" cy="22" r="14" fill="#EF4444"/>`
  return baseSvg.replace("</svg>", `  ${dot}\n</svg>`)
}

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark")
}

function setFavicon(href: string) {
  const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')
  for (const link of links) {
    link.href = href
  }
}

function getTotalUnread(bootstrap: WorkspaceBootstrap | undefined): number {
  if (!bootstrap?.unreadCounts) return 0
  const muted = new Set(bootstrap.mutedStreamIds ?? [])
  return Object.entries(bootstrap.unreadCounts).reduce<number>(
    (sum, [streamId, count]) => (muted.has(streamId) ? sum : sum + count),
    0
  )
}

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Updates the document title and favicon to reflect unread message count.
 *
 * When there are unread messages:
 * - Title becomes "(N) Threa"
 * - Favicon gets a red notification dot
 *
 * When all messages are read, both revert to defaults.
 */
export function useUnreadTabIndicator(workspaceId: string) {
  const queryClient = useQueryClient()
  const prevCountRef = useRef<number>(0)

  useEffect(() => {
    const bootstrapKey = workspaceKeys.bootstrap(workspaceId)

    // Reset so the first update() always writes to the DOM, even if the new
    // workspace happens to have the same unread count as the previous one.
    prevCountRef.current = -1

    function update() {
      const bootstrap = queryClient.getQueryData<WorkspaceBootstrap>(bootstrapKey)
      const totalUnread = getTotalUnread(bootstrap)

      // Skip DOM updates if count hasn't changed
      if (totalUnread === prevCountRef.current) return
      prevCountRef.current = totalUnread

      // Update title
      document.title = totalUnread > 0 ? `(${totalUnread}) ${BASE_TITLE}` : BASE_TITLE

      // Update favicon
      const dark = isDarkMode()
      const baseSvg = dark ? DARK_FAVICON_SVG : LIGHT_FAVICON_SVG
      const svg = totalUnread > 0 ? addNotificationDot(baseSvg) : baseSvg
      setFavicon(svgToDataUri(svg))
    }

    // Run immediately
    update()

    // Subscribe to cache changes for the workspace bootstrap query
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && arraysEqual(event.query.queryKey, bootstrapKey)) {
        update()
      }
    })

    // Re-render favicon when theme changes so the correct base SVG is used
    let lastDark = isDarkMode()
    const themeObserver = new MutationObserver(() => {
      const nowDark = isDarkMode()
      if (nowDark === lastDark) return
      lastDark = nowDark
      prevCountRef.current = -1
      update()
    })
    themeObserver.observe(document.documentElement, { attributeFilter: ["class"] })

    return () => {
      unsubscribe()
      themeObserver.disconnect()
      // Restore defaults on unmount
      document.title = BASE_TITLE
      const dark = isDarkMode()
      const baseSvg = dark ? DARK_FAVICON_SVG : LIGHT_FAVICON_SVG
      setFavicon(svgToDataUri(baseSvg))
    }
  }, [queryClient, workspaceId])
}
