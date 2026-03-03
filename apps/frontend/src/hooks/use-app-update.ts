import { useEffect, useRef, useCallback } from "react"
import { toast } from "sonner"
import { usePageActivity } from "./use-page-activity"
import { useSocketReconnectCount } from "@/contexts/socket-context"

const POLL_INTERVAL = 300_000 // 5 minutes
const TOAST_ID = "app-update"

export function useAppUpdate(): void {
  if (__APP_VERSION__ === "dev") return

  const toastShownRef = useRef(false)
  const { isVisible } = usePageActivity()
  const reconnectCount = useSocketReconnectCount()

  const checkForUpdate = useCallback(async () => {
    if (toastShownRef.current) return

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
    const id = setInterval(checkForUpdate, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [checkForUpdate])

  // Check when tab becomes visible
  useEffect(() => {
    if (isVisible) {
      checkForUpdate()
    }
  }, [isVisible, checkForUpdate])

  // Check on socket reconnect
  useEffect(() => {
    if (reconnectCount > 0) {
      checkForUpdate()
    }
  }, [reconnectCount, checkForUpdate])
}
