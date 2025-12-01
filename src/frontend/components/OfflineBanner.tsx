/**
 * Offline Banner
 *
 * Shows connectivity status and pending message count.
 * Displays at the top of the app when offline or when messages are pending.
 */

import { WifiOff, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react"
import { useOffline } from "../contexts/OfflineContext"

export function OfflineBanner() {
  const { isOnline, connectionState, pendingMessageCount, isProcessingOutbox, retryPending } = useOffline()

  // Don't show anything when online and no pending messages
  if (isOnline && pendingMessageCount === 0) return null

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
      style={{
        background: isOnline ? "var(--bg-secondary)" : "rgba(239, 68, 68, 0.1)",
        borderBottom: "1px solid var(--border-subtle)",
        color: isOnline ? "var(--text-secondary)" : "#ef4444",
      }}
    >
      <div className="flex items-center gap-2">
        {!isOnline ? (
          <>
            <WifiOff className="h-4 w-4" />
            <span>{connectionState === "reconnecting" ? "Reconnecting..." : "You're offline"}</span>
            {pendingMessageCount > 0 && (
              <span className="opacity-70">
                • {pendingMessageCount} message{pendingMessageCount > 1 ? "s" : ""} will send when you reconnect
              </span>
            )}
          </>
        ) : (
          <>
            {isProcessingOutbox ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Sending pending messages...</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span style={{ color: "var(--text-secondary)" }}>
                  {pendingMessageCount} message{pendingMessageCount > 1 ? "s" : ""} failed to send
                </span>
              </>
            )}
          </>
        )}
      </div>

      {isOnline && pendingMessageCount > 0 && !isProcessingOutbox && (
        <button
          onClick={retryPending}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors hover:bg-white/10"
          style={{ color: "var(--accent-primary)" }}
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  )
}

/**
 * Small offline indicator for tight spaces (e.g., header)
 */
export function OfflineIndicator() {
  const { isOnline, connectionState, pendingMessageCount } = useOffline()

  if (isOnline && pendingMessageCount === 0) return null

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs"
      style={{
        background: isOnline ? "var(--bg-tertiary)" : "rgba(239, 68, 68, 0.15)",
        color: isOnline ? "var(--text-muted)" : "#ef4444",
      }}
      title={
        !isOnline
          ? connectionState === "reconnecting"
            ? "Reconnecting..."
            : "You're offline"
          : `${pendingMessageCount} pending message${pendingMessageCount > 1 ? "s" : ""}`
      }
    >
      {!isOnline ? <WifiOff className="h-3 w-3" /> : <span className="font-medium">{pendingMessageCount}</span>}
    </div>
  )
}

/**
 * Connection success toast trigger (for when coming back online)
 */
export function useConnectionToasts() {
  // This hook would listen for connection state changes and show toasts
  // Leaving as a placeholder for future enhancement
}
