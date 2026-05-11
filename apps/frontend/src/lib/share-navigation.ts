import type { useLocation, useNavigate } from "react-router-dom"

/**
 * Decide what to do after `queueShareHandoff` for any share affordance —
 * fast-path entries in the message context menu and the cross-stream
 * picker modal both call here so the navigation behavior stays
 * consistent across surfaces.
 *
 * Behavior diverges by viewport because the meaning of the panel query
 * (`?panel=…`) differs:
 *
 * - **Desktop two-pane:** the panel renders alongside the main view, so
 *   the parent composer is mounted and visible. Preserve `location.search`
 *   so the panel stays open across the navigation. Skip `navigate()` when
 *   pathname + search are unchanged — the existing composer subscribes to
 *   the handoff store and picks the share up in place.
 *
 * - **Mobile fullscreen:** the panel TAKES OVER the screen, so the parent
 *   composer is NOT visible even when the URL pathname matches the share
 *   target. Drop the search on mobile so navigating to the bare pathname
 *   swaps the view back to the parent's main composer. Without this, the
 *   share queues but the user is still looking at the thread and nothing
 *   visible happens.
 */
export function navigateAfterShareHandoff({
  workspaceId,
  targetStreamId,
  location,
  navigate,
  isMobile,
}: {
  workspaceId: string
  targetStreamId: string
  location: ReturnType<typeof useLocation>
  navigate: ReturnType<typeof useNavigate>
  isMobile: boolean
}): void {
  const targetPathname = `/w/${workspaceId}/s/${targetStreamId}`
  const search = isMobile ? "" : location.search
  if (location.pathname === targetPathname && location.search === search) return
  navigate(`${targetPathname}${search}`)
}
