import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react"
import { io, Socket } from "socket.io-client"
import { api } from "@/api/client"
import { usePageActivity } from "@/hooks/use-page-activity"
import { usePageInteraction } from "@/hooks/use-page-interaction"

/**
 * Socket connection status.
 * - "disconnected": No connection (initial state or after reconnect failure)
 * - "connecting": Attempting initial connection
 * - "connected": Successfully connected
 * - "reconnecting": Was connected, now attempting to reconnect
 */
export type SocketStatus = "disconnected" | "connecting" | "connected" | "reconnecting"

interface SocketContextValue {
  socket: Socket | null
  /** Current connection status */
  status: SocketStatus
  /** Counter that increments on each reconnection (use in useEffect deps to trigger re-bootstrap) */
  reconnectCount: number
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  status: "disconnected",
  reconnectCount: 0,
})

interface WorkspaceConfig {
  region: string
  wsUrl: string
}

interface SocketProviderProps {
  workspaceId: string
  children: ReactNode
}

export function SocketProvider({ workspaceId, children }: SocketProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [status, setStatus] = useState<SocketStatus>("connecting")
  const [reconnectCount, setReconnectCount] = useState(0)
  const pageActivity = usePageActivity()
  const pageInteraction = usePageInteraction()

  // Track if we've ever been connected (to distinguish initial connect from reconnect)
  const hasEverConnectedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let newSocket: Socket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    async function connect(attempt = 0) {
      try {
        const config = await api.get<WorkspaceConfig>(`/api/workspaces/${workspaceId}/config`)
        if (cancelled) return

        // In dev, the router returns ws://localhost:PORT but we may be accessing
        // from a different host (e.g. phone over WiFi). Rewrite to match the actual host.
        const wsUrl = import.meta.env.DEV ? config.wsUrl.replace("localhost", window.location.hostname) : config.wsUrl

        newSocket = io(wsUrl, {
          path: "/socket.io/",
          withCredentials: true,
          autoConnect: true,
        })

        newSocket.on("connect", () => {
          const wasReconnecting = hasEverConnectedRef.current
          hasEverConnectedRef.current = true
          setStatus("connected")

          if (wasReconnecting) {
            setReconnectCount((c) => c + 1)
            console.log("[Socket] Reconnected successfully")
          } else {
            console.log("[Socket] Connected to", config.region)
          }
        })

        newSocket.on("disconnect", (reason) => {
          if (hasEverConnectedRef.current) {
            setStatus("reconnecting")
            console.log("[Socket] Disconnected:", reason)
          } else {
            setStatus("disconnected")
          }
        })

        newSocket.on("error", (error: { message: string }) => {
          console.error("[Socket] Error:", error.message)
        })

        // Socket.io manager events for reconnection tracking
        newSocket.io.on("reconnect_attempt", (socketAttempt) => {
          setStatus("reconnecting")
          console.log(`[Socket] Reconnect attempt ${socketAttempt}`)
        })

        newSocket.io.on("reconnect_error", (error) => {
          console.error("[Socket] Reconnect error:", error.message)
        })

        newSocket.io.on("reconnect_failed", () => {
          console.error("[Socket] Reconnect failed - giving up")
          setStatus("disconnected")
        })

        setSocket(newSocket)
      } catch (error) {
        console.error("[Socket] Failed to fetch workspace config:", error)
        if (cancelled) return

        // Retry with exponential backoff (1s, 2s, 4s, then give up)
        if (attempt < 3) {
          const delay = 1000 * Math.pow(2, attempt)
          console.log(`[Socket] Retrying config fetch in ${delay}ms (attempt ${attempt + 1}/3)`)
          setStatus("reconnecting")
          retryTimer = setTimeout(() => {
            if (!cancelled) connect(attempt + 1)
          }, delay)
        } else {
          console.error("[Socket] Config fetch failed after 3 retries — giving up")
          setStatus("disconnected")
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      hasEverConnectedRef.current = false
      if (retryTimer) clearTimeout(retryTimer)
      newSocket?.close()
      setSocket(null)
      setStatus("connecting")
      setReconnectCount(0)
    }
  }, [workspaceId])

  // Heartbeat for push notification session tracking. Sends { focused, interacted }
  // so the backend can pick the device the user is actually on (focused window
  // with a recent interaction) and avoid pushing to background PWAs.
  const lastFocusChangeHeartbeatRef = useRef(0)
  const lastInteractionHeartbeatRef = useRef(0)
  const lastHeartbeatInteractionAtRef = useRef(0)
  const previousPageActivityRef = useRef(pageActivity)
  const pageFocusedRef = useRef(pageActivity.isFocused)
  pageFocusedRef.current = pageActivity.isFocused

  useEffect(() => {
    if (!socket || status !== "connected") return

    const emitHeartbeat = () => {
      const lastInteractionAt = pageInteraction.getLastInteractionAt()
      const interacted = lastInteractionAt > lastHeartbeatInteractionAtRef.current
      if (interacted) lastHeartbeatInteractionAtRef.current = lastInteractionAt
      socket.emit("heartbeat", { focused: pageFocusedRef.current, interacted })
    }

    // Emit immediately so the backend knows this tab is active right away
    emitHeartbeat()
    const heartbeatInterval = setInterval(emitHeartbeat, 30_000)

    // Fire an immediate heartbeat on the first interaction after a quiet
    // stretch so the backend learns about renewed activity within seconds,
    // not up to 30s. The 15s throttle matches the server-side floor in
    // socket.ts; interaction-flagged heartbeats bypass that throttle there.
    const unsubscribe = pageInteraction.subscribe(() => {
      const now = Date.now()
      if (now - lastInteractionHeartbeatRef.current < 15_000) return
      lastInteractionHeartbeatRef.current = now
      emitHeartbeat()
    })

    return () => {
      clearInterval(heartbeatInterval)
      unsubscribe()
    }
  }, [socket, status, pageInteraction])

  useEffect(() => {
    const previousPageActivity = previousPageActivityRef.current
    const gainedFocus = !previousPageActivity.isFocused && pageActivity.isFocused
    const becameVisible = !previousPageActivity.isVisible && pageActivity.isVisible

    if (!socket || status !== "connected") {
      previousPageActivityRef.current = pageActivity
      return
    }

    previousPageActivityRef.current = pageActivity

    if (!gainedFocus && !becameVisible) return

    // Focus gains always emit — bypassing the throttle prevents a becameVisible
    // heartbeat (focused=false) from blocking the closely-following gainedFocus
    // heartbeat (focused=true) via the 10s throttle window.
    const now = Date.now()
    if (gainedFocus || now - lastFocusChangeHeartbeatRef.current > 10_000) {
      lastFocusChangeHeartbeatRef.current = now
      socket.emit("heartbeat", { focused: pageActivity.isFocused, interacted: false })
    }
  }, [socket, status, pageActivity])

  return <SocketContext.Provider value={{ socket, status, reconnectCount }}>{children}</SocketContext.Provider>
}

export function useSocket(): Socket | null {
  return useContext(SocketContext).socket
}

export function useSocketStatus(): SocketStatus {
  return useContext(SocketContext).status
}

export function useSocketConnected(): boolean {
  return useContext(SocketContext).status === "connected"
}

export function useSocketReconnectCount(): number {
  return useContext(SocketContext).reconnectCount
}

export function useSocketIsReconnecting(): boolean {
  return useContext(SocketContext).status === "reconnecting"
}
