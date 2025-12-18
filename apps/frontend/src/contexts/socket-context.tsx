import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { io, Socket } from "socket.io-client"

interface SocketContextValue {
  socket: Socket | null
  isConnected: boolean
}

const SocketContext = createContext<SocketContextValue>({ socket: null, isConnected: false })

interface SocketProviderProps {
  children: ReactNode
}

export function SocketProvider({ children }: SocketProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const newSocket = io({
      path: "/socket.io/",
      withCredentials: true,
      autoConnect: true,
    })

    newSocket.on("connect", () => {
      setIsConnected(true)
    })

    newSocket.on("disconnect", () => {
      setIsConnected(false)
    })

    newSocket.on("error", (error: { message: string }) => {
      console.error("Socket error:", error.message)
    })

    setSocket(newSocket)

    return () => {
      newSocket.close()
    }
  }, [])

  return <SocketContext.Provider value={{ socket, isConnected }}>{children}</SocketContext.Provider>
}

export function useSocket(): Socket | null {
  return useContext(SocketContext).socket
}

export function useSocketConnected(): boolean {
  return useContext(SocketContext).isConnected
}
