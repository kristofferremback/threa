import { useEffect, useRef, useCallback } from "react"
import { toast } from "sonner"
import { usePageActivity } from "./use-page-activity"
import { useSocketReconnectCount } from "@/contexts"

const POLL_INTERVAL = 300_000 // 5 minutes
const TOAST_ID = "app-update"
const IS_DEV = import.meta.env.DEV

/**
 * Tell the browser to check for a new service worker. The SW's install handler
 * calls skipWaiting() unconditionally, so it activates immediately — no need
 * to post a message or check registration.waiting.
 */
async function triggerSwUpdate(): Promise<void> {
  const registration = await navigator.serviceWorker?.getRegistration()
  if (!registration) return
  await registration.update()
}

/**
 * Reload the page to pick up the new service worker's precached assets.
 * By the time this runs, triggerSwUpdate() has already activated the new SW
 * (which cleans stale caches on activate). A plain reload is enough — the new
 * SW serves fresh assets from its precache. Clearing caches here would break
 * offline refresh, so we intentionally leave them for the SW to manage.
 */
function reloadForUpdate(): void {
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
            onClick: () => reloadForUpdate(),
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
