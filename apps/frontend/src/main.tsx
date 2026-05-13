import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { router } from "./routes"
import { SW_MSG_NOTIFICATION_CLICK, SW_MSG_SUBSCRIPTION_CHANGED } from "./lib/sw-messages"
import { hydrateCollapseCache } from "./lib/markdown/collapse-cache"
import { applyPersistedComposerHeight } from "./lib/composer-height-storage"
import "./index.css"

// Bulk-load persisted markdown-block + link-preview collapse state into the
// in-memory mirror before the first timeline paint. Synchronous consumers
// (`useBlockCollapse`, `useLinkPreviewCollapse`) see the persisted choices on
// their first render, eliminating the post-mount resize cascade that Virtuoso
// otherwise compensates for by shifting sibling rows.
void hydrateCollapseCache()

// Apply the last-observed composer height to `:root` so the timeline's footer
// spacer paints at roughly the correct size on first render. The composer's
// own ResizeObserver overwrites the variable on the editor zone once mounted.
applyPersistedComposerHeight()

// Handle messages from the service worker
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === SW_MSG_NOTIFICATION_CLICK && event.data.url) {
    // Client-side navigation preserves React tree, TanStack Query cache, and socket connection
    const url = event.data.url as string
    if (url.startsWith("/")) {
      router.navigate(url)
    }
  }
  if (event.data?.type === SW_MSG_SUBSCRIPTION_CHANGED) {
    // The push subscription was rotated by the browser. Dispatch a custom event
    // so the push notifications hook can re-register without a full page reload.
    window.dispatchEvent(new CustomEvent("pushsubscriptionchanged"))
  }
})

// Register as soon as the main bundle runs — before React effects that call
// `navigator.serviceWorker.ready` (push subscribe). Deferring to `window` "load"
// can delay activation until all subresources finish; a slow page then races the
// 15s push subscribe timeout. Google's SW guidance also recommends registering early.
// updateViaCache: 'none' forces a network byte-check of sw.js instead of HTTP cache.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((err) => {
    console.error("[SW] Registration failed — push and offline updates will not work:", err)
  })
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
