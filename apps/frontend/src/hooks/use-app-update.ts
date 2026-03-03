import { useEffect, useRef, useCallback } from "react"
import { toast } from "sonner"
import { usePageActivity } from "./use-page-activity"
import { useSocketReconnectCount } from "@/contexts"

const POLL_INTERVAL = 300_000 // 5 minutes
const TOAST_ID = "app-update"
const IS_DEV = __APP_VERSION__ === "dev"

export function useAppUpdate(): void {
  const toastShownRef = useRef(false)
  const { isVisible } = usePageActivity()
  const reconnectCount = useSocketReconnectCount()

  const checkForUpdate = useCallback(async () => {
    if (IS_DEV || toastShownRef.current) return

    try {
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
            onClick: () => window.location.reload(),
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
