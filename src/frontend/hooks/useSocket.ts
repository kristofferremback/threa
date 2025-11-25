import { useEffect, useRef, useState, useCallback } from "react"
import { io, Socket } from "socket.io-client"
import { toast } from "sonner"

interface UseSocketOptions {
  enabled?: boolean
  onConnect?: () => void
  onDisconnect?: () => void
}

interface UseSocketReturn {
  socket: Socket | null
  isConnected: boolean
  connectionError: string | null
  emit: (event: string, data?: any) => void
  join: (room: string) => void
  leave: (room: string) => void
}

export function useSocket({ enabled = true, onConnect, onDisconnect }: UseSocketOptions = {}): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }

    const socket = io({ withCredentials: true })
    socketRef.current = socket

    socket.on("connect", () => {
      setIsConnected(true)
      setConnectionError(null)
      onConnect?.()
    })

    socket.on("disconnect", () => {
      setIsConnected(false)
      onDisconnect?.()
    })

    socket.on("error", (err: { message?: string }) => {
      const errorMessage = err.message || "Connection error"
      setConnectionError(errorMessage)
      setIsConnected(false)
      toast.error(errorMessage)
    })

    socket.on("connect_error", () => {
      toast.error("Failed to connect to server")
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [enabled, onConnect, onDisconnect])

  const emit = useCallback((event: string, data?: any) => {
    socketRef.current?.emit(event, data)
  }, [])

  const join = useCallback((room: string) => {
    socketRef.current?.emit("join", room)
  }, [])

  const leave = useCallback((room: string) => {
    socketRef.current?.emit("leave", room)
  }, [])

  return {
    socket: socketRef.current,
    isConnected,
    connectionError,
    emit,
    join,
    leave,
  }
}


