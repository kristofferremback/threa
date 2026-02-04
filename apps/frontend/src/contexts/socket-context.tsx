import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react"
import { io, Socket } from "socket.io-client"

interface SocketContextValue {
  socket: Socket | null
  isConnected: boolean
  /** Counter that increments on each reconnection (use in useEffect deps to trigger re-bootstrap) */
  reconnectCount: number
  /** True when we've had a connection before and are now reconnecting */
  isReconnecting: boolean
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
  reconnectCount: 0,
  isReconnecting: false,
})

interface SocketProviderProps {
  children: ReactNode
}

export function SocketProvider({ children }: SocketProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [reconnectCount, setReconnectCount] = useState(0)
  const [isReconnecting, setIsReconnecting] = useState(false)

  // Track if we've ever been connected (to distinguish initial connect from reconnect)
  const hasEverConnectedRef = useRef(false)

  useEffect(() => {
    const newSocket = io({
      path: "/socket.io/",
      withCredentials: true,
      autoConnect: true,
    })

    newSocket.on("connect", () => {
      const wasReconnecting = hasEverConnectedRef.current && !isConnected
      hasEverConnectedRef.current = true
      setIsConnected(true)
      setIsReconnecting(false)

      if (wasReconnecting) {
        // This is a reconnect, not initial connect
        setReconnectCount((c) => c + 1)
        console.log("[Socket] Reconnected successfully")
      } else {
        console.log("[Socket] Connected")
      }
    })

    newSocket.on("disconnect", (reason) => {
      setIsConnected(false)
      if (hasEverConnectedRef.current) {
        setIsReconnecting(true)
        console.log("[Socket] Disconnected:", reason)
      }
    })

    newSocket.on("error", (error: { message: string }) => {
      console.error("[Socket] Error:", error.message)
    })

    // Socket.io manager events for reconnection tracking
    newSocket.io.on("reconnect_attempt", (attempt) => {
      setIsReconnecting(true)
      console.log(`[Socket] Reconnect attempt ${attempt}`)
    })

    newSocket.io.on("reconnect_error", (error) => {
      console.error("[Socket] Reconnect error:", error.message)
    })

    newSocket.io.on("reconnect_failed", () => {
      console.error("[Socket] Reconnect failed - giving up")
      setIsReconnecting(false)
    })

    setSocket(newSocket)

    return () => {
      newSocket.close()
    }
  }, [])

  return (
    <SocketContext.Provider value={{ socket, isConnected, reconnectCount, isReconnecting }}>
      {children}
    </SocketContext.Provider>
  )
}

export function useSocket(): Socket | null {
  return useContext(SocketContext).socket
}

export function useSocketConnected(): boolean {
  return useContext(SocketContext).isConnected
}

export function useSocketReconnectCount(): number {
  return useContext(SocketContext).reconnectCount
}

export function useSocketIsReconnecting(): boolean {
  return useContext(SocketContext).isReconnecting
}
