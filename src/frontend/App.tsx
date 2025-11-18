import { StrictMode, useState, useEffect, useRef } from "react"
import { createRoot } from "react-dom/client"
import { io, Socket } from "socket.io-client"
import { formatDistanceToNow } from "date-fns"
import { Send, LogOut, MessageCircle, Circle } from "lucide-react"
import { Toaster, toast } from "sonner"
import { AuthProvider, useAuth } from "./auth"
import "./index.css"

function App() {
  const { isAuthenticated, user } = useAuth()
  const [messages, setMessages] = useState<Array<{ id?: string; userId?: string; email: string; message: string; timestamp: string }>>([])
  const [inputMessage, setInputMessage] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Connect to Socket.IO when authenticated
  useEffect(() => {
    if (!isAuthenticated) return

    const socket = io({
      withCredentials: true,
    })

    socketRef.current = socket

    socket.on("connect", () => {
      console.log("Socket.IO connected")
      setIsConnected(true)
      toast.success("Connected to chat")
    })

    socket.on("connected", (data) => {
      console.log("Welcome:", data.message)
    })

    socket.on("messages", (data) => {
      console.log("Received messages:", data)
      setMessages(data)
    })

    socket.on("message", (data) => {
      console.log("New message:", data)
      setMessages((prev) => [...prev, data])
    })

    socket.on("disconnect", () => {
      console.log("Socket.IO disconnected")
      setIsConnected(false)
      toast.error("Disconnected from chat")
    })

    socket.on("connect_error", (error) => {
      console.error("Connection error:", error.message)
      setIsConnected(false)
      toast.error("Connection error")
    })

    return () => {
      socket.disconnect()
    }
  }, [isAuthenticated])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleLogin = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()

    window.location.href = "/api/auth/login"
  }

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      })
    } catch (error) {
      console.error("Logout error:", error)
    }

    localStorage.clear()
    socketRef.current?.disconnect()
    setMessages([])
    window.location.reload()
  }

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()

    if (!inputMessage.trim() || !socketRef.current?.connected) return

    socketRef.current.emit("message", { message: inputMessage })
    setInputMessage("")
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-zinc-950 font-sans">
        <div className="flex flex-col items-center gap-4 text-center">
          <MessageCircle className="h-16 w-16 text-blue-500" />
          <h2 className="text-2xl font-semibold">Welcome to Threa</h2>
          <p className="text-gray-400">A minimal chat application with WorkOS authentication</p>
          <button
            onClick={handleLogin}
            className="rounded-md bg-white px-6 py-2.5 text-sm font-medium text-black transition-colors hover:bg-gray-100"
          >
            Login with WorkOS
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <Toaster position="top-center" richColors />
      <div className="mx-auto flex h-screen w-full max-w-3xl flex-col bg-zinc-950 p-5 font-sans text-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-5">
          <div className="flex items-center gap-3">
            <MessageCircle className="h-6 w-6 text-blue-500" />
            <h1 className="text-2xl font-semibold">Threa</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{user?.email}</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-700"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </div>

        {/* Connection Status */}
        <div
          className={`mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
            isConnected ? "bg-green-950/50 text-green-400" : "bg-red-950/50 text-red-400"
          }`}
        >
          <Circle className={`h-2 w-2 ${isConnected ? "fill-green-400" : "fill-red-400"}`} />
          {isConnected ? "Connected" : "Disconnected"}
        </div>

        {/* Messages */}
        <div className="mb-4 mt-4 flex-1 overflow-y-auto rounded-lg bg-zinc-900 p-4">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-gray-500">
              <p>No messages yet. Start chatting!</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id || msg.timestamp} className="mb-2 rounded-md bg-zinc-800 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium text-blue-400">{msg.email}</span>
                  <span className="text-xs text-gray-500">
                    {formatDistanceToNow(new Date(msg.timestamp), { addSuffix: true })}
                  </span>
                </div>
                <div className="text-sm text-gray-200">{msg.message}</div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Form */}
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!inputMessage.trim() || !isConnected}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-6 py-3 text-sm font-medium transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Send
          </button>
        </form>
      </div>
    </>
  )
}

const root = createRoot(document.getElementById("root")!)
root.render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
