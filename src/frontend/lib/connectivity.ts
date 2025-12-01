/**
 * Connectivity Manager
 *
 * Tracks online/offline state using multiple signals:
 * - navigator.onLine (coarse, instant)
 * - Periodic ping to server (fine-grained)
 * - WebSocket connection state (real-time indicator)
 */

export type ConnectionState = "online" | "offline" | "reconnecting"

type Listener = (state: ConnectionState) => void

class ConnectivityManager {
  private state: ConnectionState = "online"
  private listeners = new Set<Listener>()
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private wsConnected = false
  private lastPingSuccess = true

  constructor() {
    if (typeof window !== "undefined") {
      this.init()
    }
  }

  private init(): void {
    // Initialize from navigator.onLine
    this.updateState(navigator.onLine ? "online" : "offline")

    // Listen for browser online/offline events
    window.addEventListener("online", () => {
      this.lastPingSuccess = true
      this.updateState("reconnecting")
      this.checkConnectivity()
    })

    window.addEventListener("offline", () => {
      this.lastPingSuccess = false
      this.updateState("offline")
    })

    // Start periodic ping (only when tab is visible)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.startPing()
      } else {
        this.stopPing()
      }
    })

    if (document.visibilityState === "visible") {
      this.startPing()
    }
  }

  private startPing(): void {
    // Ping every 30 seconds when visible
    if (this.pingInterval) return

    this.checkConnectivity()
    this.pingInterval = setInterval(() => {
      this.checkConnectivity()
    }, 30000)
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  private updateState(newState: ConnectionState): void {
    if (this.state === newState) return

    this.state = newState
    this.listeners.forEach((listener) => {
      try {
        listener(newState)
      } catch (err) {
        console.warn("[Connectivity] Listener error:", err)
      }
    })
  }

  /**
   * Perform a connectivity check by fetching a small endpoint
   */
  async checkConnectivity(): Promise<boolean> {
    if (!navigator.onLine) {
      this.lastPingSuccess = false
      this.updateState("offline")
      return false
    }

    try {
      // Use a simple HEAD request to check connectivity
      // Add cache-busting to avoid cached responses
      const response = await fetch(`/api/auth/me?_=${Date.now()}`, {
        method: "HEAD",
        credentials: "include",
        cache: "no-store",
      })

      this.lastPingSuccess = response.ok || response.status === 401 // 401 is fine, means server is reachable

      if (this.lastPingSuccess) {
        this.updateState("online")
        return true
      } else {
        this.updateState(this.wsConnected ? "reconnecting" : "offline")
        return false
      }
    } catch {
      this.lastPingSuccess = false
      this.updateState(this.wsConnected ? "reconnecting" : "offline")
      return false
    }
  }

  /**
   * Update WebSocket connection state (called from socket hooks)
   */
  setWebSocketConnected(connected: boolean): void {
    this.wsConnected = connected

    if (connected && this.state !== "online") {
      this.updateState("online")
    } else if (!connected && this.state === "online" && !this.lastPingSuccess) {
      this.updateState("reconnecting")
    }
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state
  }

  /**
   * Check if currently online
   */
  isOnline(): boolean {
    return this.state === "online"
  }

  /**
   * Subscribe to state changes
   */
  subscribe(callback: Listener): () => void {
    this.listeners.add(callback)

    // Immediately call with current state
    callback(this.state)

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback)
    }
  }

  /**
   * Force a connectivity check and return result
   */
  async forceCheck(): Promise<boolean> {
    return this.checkConnectivity()
  }
}

// Singleton instance
export const connectivity = new ConnectivityManager()

// Export useful functions
export function isOnline(): boolean {
  return connectivity.isOnline()
}

export function getConnectionState(): ConnectionState {
  return connectivity.getState()
}

export function subscribeToConnectivity(callback: Listener): () => void {
  return connectivity.subscribe(callback)
}

export function setWebSocketConnected(connected: boolean): void {
  connectivity.setWebSocketConnected(connected)
}

export function checkConnectivity(): Promise<boolean> {
  return connectivity.forceCheck()
}
