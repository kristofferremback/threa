import { useSyncExternalStore } from "react"
import { useSocketStatus } from "@/contexts"
import { WifiOff, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

function useIsOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb)
      window.addEventListener("offline", cb)
      return () => {
        window.removeEventListener("online", cb)
        window.removeEventListener("offline", cb)
      }
    },
    () => navigator.onLine
  )
}

/**
 * Non-blocking banner that shows when the app is offline, reconnecting, or disconnected.
 * Renders nothing when connected. Placed above the main content area in the app shell.
 */
export function ConnectionStatus() {
  const socketStatus = useSocketStatus()
  const isOnline = useIsOnline()

  if (socketStatus === "connected") return null

  // Offline (no network at all)
  if (!isOnline) {
    return (
      <div className={cn("flex items-center gap-2 px-4 py-1.5 text-xs", "bg-amber-500/10 text-amber-600")}>
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        <span>You're offline. Messages will send when you reconnect.</span>
      </div>
    )
  }

  // Reconnecting (had connection, lost it, trying to recover)
  if (socketStatus === "reconnecting") {
    return (
      <div className={cn("flex items-center gap-2 px-4 py-1.5 text-xs", "bg-blue-500/10 text-blue-500")}>
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span>Reconnecting...</span>
      </div>
    )
  }

  // Disconnected (socket lost, not yet reconnecting — rare, usually transient)
  if (socketStatus === "disconnected") {
    return (
      <div className={cn("flex items-center gap-2 px-4 py-1.5 text-xs", "bg-destructive/10 text-destructive")}>
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        <span>Connection lost. Reconnecting shortly...</span>
      </div>
    )
  }

  return null
}
