import { useEffect, useRef, useCallback } from "react"
import { toast } from "sonner"
import { usePageActivity } from "./use-page-activity"
import { useSocketReconnectCount } from "@/contexts"

const POLL_INTERVAL = 300_000 // 5 minutes
const TOAST_ID = "app-update"
const IS_DEV = import.meta.env.DEV

/** Cap how long the Reload action waits for the new SW before reloading anyway. */
const UPDATE_RELOAD_FALLBACK_MS = 10_000

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
 * Reload onto the new build.
 *
 * The SW serves navigations cache-first from the build-atomic precache, so a
 * plain reload returns whatever build the *currently controlling* SW precached.
 * If the new SW hasn't installed and claimed this page yet, that is still the
 * old build and the version toast just reappears — which is why an
 * unconditional reload needed "a bunch of refreshes". So force the update now
 * and reload exactly once when the new SW takes control: it self-activates via
 * skipWaiting + clients.claim, firing `controllerchange`. Fall back to a plain
 * reload when there is no registration, no pending worker (the new SW already
 * claimed in the background), or the update stalls — never worse than a bare
 * reload, and time-bounded.
 */
async function reloadForUpdate(): Promise<void> {
  const registration = await navigator.serviceWorker?.getRegistration()
  if (!registration) {
    window.location.reload()
    return
  }

  let reloaded = false
  const reloadOnce = (): void => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  }

  // Subscribe before update() so a fast activate→claim can't fire the event
  // before we are listening.
  navigator.serviceWorker.addEventListener("controllerchange", reloadOnce, { once: true })

  try {
    await registration.update()
  } catch {
    reloadOnce()
    return
  }

  const pending = registration.installing ?? registration.waiting
  if (!pending) {
    // The new SW already installed and took control in the background — a
    // plain reload now serves its precached shell.
    reloadOnce()
    return
  }

  // Backstop for controllerchange in case it does not fire for this client:
  // reload as soon as the new SW reaches `activated`.
  pending.addEventListener("statechange", () => {
    if (pending.state === "activated") reloadOnce()
  })

  // Last resort so a stuck install can't strand the toast indefinitely.
  setTimeout(reloadOnce, UPDATE_RELOAD_FALLBACK_MS)
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
            onClick: () => void reloadForUpdate(),
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
