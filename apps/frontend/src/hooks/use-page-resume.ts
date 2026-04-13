import { useEffect, useRef } from "react"

const DEFAULT_HIDDEN_THRESHOLD_MS = 10_000

/**
 * Fires `onResume` when the page transitions from hidden → visible after
 * being hidden for at least `hiddenThresholdMs` (default 10s).
 *
 * The threshold filters out quick app-switcher previews and notification-shade
 * glances, so the callback only runs when the page was genuinely backgrounded
 * long enough that socket events may have been missed.
 *
 * `onResume` is stored in a ref so consumers don't need to memoize.
 */
export function usePageResume(onResume: () => void, hiddenThresholdMs: number = DEFAULT_HIDDEN_THRESHOLD_MS): void {
  const onResumeRef = useRef(onResume)
  onResumeRef.current = onResume

  useEffect(() => {
    let hiddenSince: number | null = null

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince = Date.now()
        return
      }

      if (document.visibilityState === "visible") {
        if (hiddenSince !== null && Date.now() - hiddenSince >= hiddenThresholdMs) {
          onResumeRef.current()
        }
        hiddenSince = null
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [hiddenThresholdMs])
}
