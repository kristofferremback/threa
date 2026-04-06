import { useEffect, useRef, useCallback } from "react"
import { toast } from "sonner"
import { usePageActivity } from "./use-page-activity"
import { useSocketReconnectCount } from "@/contexts"
import { SW_MSG_SKIP_WAITING } from "@/lib/sw-messages"

const POLL_INTERVAL = 300_000 // 5 minutes
const TOAST_ID = "app-update"
const IS_DEV = import.meta.env.DEV

/**
 * Tell the browser to check for a new service worker and, if one is waiting,
 * activate it immediately via skipWaiting message.
 */
async function triggerSwUpdate(): Promise<void> {
  const registration = await navigator.serviceWorker?.getRegistration()
  if (!registration) return

  // Ask the browser to re-fetch sw.js and compare bytes
  await registration.update()

  // If a new worker is already waiting (installed but not active), activate it
  if (registration.waiting) {
    registration.waiting.postMessage({ type: SW_MSG_SKIP_WAITING })
  }
}

/**
 * Clear all service worker caches and hard-reload so the browser fetches
 * everything fresh from the network. This recovers from stale precache states
 * that cause missing CSS/JS (the page renders unstyled).
 */
async function hardRefresh(): Promise<void> {
  const cacheNames = await caches.keys()
  await Promise.all(cacheNames.map((name) => caches.delete(name)))
  window.location.reload()
}

export function useAppUpdate(): void {
  const toastShownRef = useRef(false)
  const { isVisible } = usePageActivity()
  const reconnectCount = useSocketReconnectCount()

  const checkForUpdate = useCallback(async () => {
    if (IS_DEV || toastShownRef.current) return

    try {
      // Trigger SW update check in parallel with version check
      triggerSwUpdate().catch(() => {})

      const res = await fetch("/version.json", { cache: "no-cache" })
      if (!res.ok) return

      const { version } = (await res.json()) as { version: string }
      if (version && version !== __APP_VERSION__) {
        toastShownRef.current = true
        toast("A new version of Threa is available", {
          id: TOAST_ID,
          duration: Infinity,
          action: {
            label: "Reload",
            onClick: () => hardRefresh(),
          },
        })
      }
    } catch {
      // Network error — silently skip this check
    }
  }, [])

  // Periodic polling
  useEffect(() => {
    if (IS_DEV) return
    const id = setInterval(checkForUpdate, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [checkForUpdate])

  // Check when tab becomes visible
  useEffect(() => {
    if (isVisible && !IS_DEV) {
      checkForUpdate()
    }
  }, [isVisible, checkForUpdate])

  // Check on socket reconnect
  useEffect(() => {
    if (reconnectCount > 0 && !IS_DEV) {
      checkForUpdate()
    }
  }, [reconnectCount, checkForUpdate])
}
