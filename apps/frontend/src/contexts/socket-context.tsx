import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react"
import { io, Socket } from "socket.io-client"
import { api } from "@/api/client"

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

  // Track if we've ever been connected (to distinguish initial connect from reconnect)
  const hasEverConnectedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let newSocket: Socket | null = null

    async function connect() {
      try {
        const config = await api.get<WorkspaceConfig>(`/api/workspaces/${workspaceId}/config`)
        if (cancelled) return

        newSocket = io(config.wsUrl, {
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
        newSocket.io.on("reconnect_attempt", (attempt) => {
          setStatus("reconnecting")
          console.log(`[Socket] Reconnect attempt ${attempt}`)
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
        if (!cancelled) {
          setStatus("disconnected")
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      hasEverConnectedRef.current = false
      newSocket?.close()
      setSocket(null)
      setStatus("connecting")
      setReconnectCount(0)
    }
  }, [workspaceId])

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
