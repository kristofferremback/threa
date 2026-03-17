import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { router } from "./routes"
import { SW_MSG_NOTIFICATION_CLICK, SW_MSG_SUBSCRIPTION_CHANGED } from "./lib/sw-messages"
import { seedCacheFromIndexedDB } from "./lib/cache-seed"
import "./index.css"

// Seed TanStack Query cache from IndexedDB before React renders.
// This is fire-and-forget — if it completes before the first query mounts,
// the UI will render instantly with cached data. If not, normal loading applies.
seedCacheFromIndexedDB()

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
