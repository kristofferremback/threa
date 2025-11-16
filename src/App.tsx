import { StrictMode, useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { io, Socket } from "socket.io-client";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [messages, setMessages] = useState<Array<{ email: string; message: string; timestamp: string }>>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check authentication on mount
  useEffect(() => {
    const accessToken = localStorage.getItem("accessToken");
    const userEmail = localStorage.getItem("email");

    if (accessToken && userEmail) {
      setEmail(userEmail);
      setIsAuthenticated(true);
    }
  }, []);

  // Connect to Socket.IO when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    const accessToken = localStorage.getItem("accessToken");
    if (!accessToken) return;

    const socket = io({
      auth: { token: accessToken },
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Socket.IO connected");
      setIsConnected(true);
    });

    socket.on("connected", (data) => {
      console.log("Welcome:", data.message);
    });

    socket.on("message", (data) => {
      setMessages((prev) => [...prev, data]);
    });

    socket.on("disconnect", () => {
      console.log("Socket.IO disconnected");
      setIsConnected(false);
    });

    socket.on("connect_error", (error) => {
      console.error("Connection error:", error.message);
      setIsConnected(false);
    });

    return () => {
      socket.disconnect();
    };
  }, [isAuthenticated]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-refresh token
  useEffect(() => {
    if (!isAuthenticated) return;

    const refreshToken = async () => {
      const token = localStorage.getItem("refreshToken");
      if (!token) return;

      try {
        const response = await fetch("/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: token }),
        });

        if (response.ok) {
          const data = await response.json();
          localStorage.setItem("accessToken", data.accessToken);
        } else {
          handleLogout();
        }
      } catch (error) {
        console.error("Token refresh error:", error);
      }
    };

    const interval = setInterval(refreshToken, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const handleLogin = () => {
    window.location.href = "/auth/login";
  };

  const handleLogout = async () => {
    const accessToken = localStorage.getItem("accessToken");

    try {
      await fetch("/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (error) {
      console.error("Logout error:", error);
    }

    localStorage.clear();
    socketRef.current?.disconnect();
    setIsAuthenticated(false);
    setMessages([]);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputMessage.trim() || !socketRef.current?.connected) return;

    socketRef.current.emit("message", { message: inputMessage });
    setInputMessage("");
  };

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
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.headerTitle}>Threa</h1>
        <div style={styles.userInfo}>
          <span style={styles.userEmail}>{email}</span>
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
              <span style={styles.messageTime}>
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
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
  );
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
};

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
