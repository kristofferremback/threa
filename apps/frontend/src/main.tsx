import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { router } from "./routes"
import { SW_MSG_NOTIFICATION_CLICK, SW_MSG_SUBSCRIPTION_CHANGED, SW_MSG_SKIP_WAITING } from "./lib/sw-messages"
import "./index.css"

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

// Register the service worker with updateViaCache: 'none' so the browser always
// byte-checks sw.js against the network instead of using the HTTP cache. This
// prevents stale SW scripts from keeping old precache manifests alive indefinitely.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        // If a new worker is already waiting at startup, activate it now
        if (registration.waiting) {
          registration.waiting.postMessage({ type: SW_MSG_SKIP_WAITING })
        }
        // Listen for future installs
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing
          newWorker?.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && registration.waiting) {
              registration.waiting.postMessage({ type: SW_MSG_SKIP_WAITING })
            }
          })
        })
      })
      .catch(() => {})
  })
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
