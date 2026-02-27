import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./index.css"

// Handle messages from the service worker
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "NOTIFICATION_CLICK" && event.data.url) {
    // Only navigate to same-origin paths to prevent open redirect
    const url = event.data.url as string
    if (url.startsWith("/")) {
      window.location.href = url
    }
  }
  if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED") {
    // The push subscription was rotated by the browser. Re-register on next page load
    // by clearing the cached subscription state so the hook re-subscribes.
    // For now, just reload the page to trigger the hook's mount logic.
    window.location.reload()
  }
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
