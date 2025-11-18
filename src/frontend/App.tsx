import { StrictMode, useState, useEffect, useRef } from "react"
import { createRoot } from "react-dom/client"
import { io, Socket } from "socket.io-client"
import { AuthProvider, useAuth } from "./auth"

function App() {
  const { isAuthenticated, user } = useAuth()
  const [messages, setMessages] = useState<Array<{ email: string; message: string; timestamp: string }>>([])
  const [inputMessage, setInputMessage] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Connect to Socket.IO when authenticated
  useEffect(() => {
    if (!isAuthenticated) return

    const socket = io({
      withCredentials: true,
      timeout: 25000,
      // path: "/socket.io/",
      path: "/socket.io/",
    })

    socketRef.current = socket

    socket.on("connect", () => {
      console.log("Socket.IO connected")
      setIsConnected(true)
    })

    socket.on("connected", (data) => {
      console.log("Welcome:", data.message)
    })

    socket.on("message", (data) => {
      console.log("New message:", data)
      setMessages((prev) => [...prev, data])
    })

    socket.on("disconnect", () => {
      console.log("Socket.IO disconnected")
      setIsConnected(false)
    })

    socket.on("connect_error", (error) => {
      console.error("Connection error:", error.message)
      setIsConnected(false)
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
      <div style={styles.container}>
        <div style={styles.loginContainer}>
          <h2>Welcome to Threa</h2>
          <p>A minimal chat application with WorkOS authentication</p>
          <button onClick={handleLogin} style={styles.button}>
            Login with WorkOS
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.headerTitle}>Threa</h1>
        <div style={styles.userInfo}>
          <span style={styles.userEmail}>{user?.email}</span>
          <button onClick={handleLogout} style={styles.buttonSecondary}>
            Logout
          </button>
        </div>
      </div>

      <div style={isConnected ? styles.statusConnected : styles.statusDisconnected}>
        {isConnected ? "Connected" : "Disconnected"}
      </div>

      <div style={styles.messages}>
        {messages.map((msg, index) => (
          <div key={index} style={styles.message}>
            <div style={styles.messageHeader}>
              <span style={styles.messageEmail}>{msg.email}</span>
              <span style={styles.messageTime}>{new Date(msg.timestamp).toLocaleTimeString()}</span>
            </div>
            <div style={styles.messageText}>{msg.message}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendMessage} style={styles.inputContainer}>
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Type a message..."
          style={styles.input}
        />
        <button type="submit" style={styles.button}>
          Send
        </button>
      </form>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: "800px",
    width: "100%",
    margin: "0 auto",
    padding: "20px",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    background: "#1a1a1a",
    color: "#fff",
  },
  loginContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    gap: "16px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px 0",
    borderBottom: "1px solid #333",
    marginBottom: "20px",
  },
  headerTitle: {
    fontSize: "24px",
    fontWeight: 600,
    margin: 0,
  },
  userInfo: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  userEmail: {
    color: "#888",
    fontSize: "14px",
  },
  button: {
    background: "#fff",
    color: "#000",
    border: "none",
    padding: "8px 16px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 500,
  },
  buttonSecondary: {
    background: "#333",
    color: "#fff",
    border: "none",
    padding: "8px 16px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 500,
  },
  statusConnected: {
    background: "#1a3a1a",
    color: "#4ade80",
    padding: "8px 12px",
    borderRadius: "6px",
    fontSize: "12px",
    marginBottom: "16px",
  },
  statusDisconnected: {
    background: "#3a1a1a",
    color: "#f87171",
    padding: "8px 12px",
    borderRadius: "6px",
    fontSize: "12px",
    marginBottom: "16px",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    background: "#0f0f0f",
    borderRadius: "8px",
    padding: "16px",
    marginBottom: "16px",
  },
  message: {
    background: "#222",
    padding: "12px",
    borderRadius: "6px",
    marginBottom: "8px",
  },
  messageHeader: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "4px",
  },
  messageEmail: {
    color: "#4a9eff",
    fontWeight: 500,
    fontSize: "14px",
  },
  messageTime: {
    color: "#666",
    fontSize: "12px",
  },
  messageText: {
    color: "#ddd",
    fontSize: "14px",
  },
  inputContainer: {
    display: "flex",
    gap: "8px",
  },
  input: {
    flex: 1,
    background: "#222",
    border: "1px solid #333",
    color: "#fff",
    padding: "12px 16px",
    borderRadius: "6px",
    fontSize: "14px",
  },
}

const root = createRoot(document.getElementById("root")!)
root.render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
