import { Server } from "socket.io"
import { Server as Engine } from "@socket.io/bun-engine"
import { CookieMap } from "bun"
import type { WorkOS } from "@workos-inc/node"
import { WORKOS_COOKIE_PASSWORD } from "../config"

export const createWebsocketServer = (workos: WorkOS): { io: Server; engine: Engine } => {
  const io = new Server()
  const engine = new Engine({
    path: "/socket.io/",
    pingTimeout: 30000,
  })

  io.bind(engine)

  io.use(async (socket, next) => {
    try {
      const cookies = new CookieMap(socket.handshake.headers.cookie || "")
      const sealedSession = cookies.get("wos_session")

      const session = workos.userManagement.loadSealedSession({
        sessionData: sealedSession!,
        cookiePassword: WORKOS_COOKIE_PASSWORD,
      })

      const authRes = await session.authenticate()
      if (authRes.authenticated) {
        socket.data.userId = authRes.user.id
        socket.data.email = authRes.user.email

        return next()
      }

      if (authRes.reason === "no_session_cookie_provided") {
        // Should log in and retry
        return next(new Error("No session cookie provided"))
      }

      return next(new Error("Invalid session, must log in again"))
    } catch (error) {
      console.error("WebSocket auth error:", error)
      next(new Error("Authentication failed"))
    }
  })

  io.on("connection", (socket) => {
    const userId = socket.data.userId
    const email = socket.data.email

    console.log(`WebSocket connected: ${email} (${userId})`)

    // Send welcome message
    socket.emit("connected", {
      message: "Connected to Threa",
    })

    // Handle chat messages
    socket.on("message", (data) => {
      console.log(`Message from ${email}:`, data)

      // Broadcast to all clients
      io.emit("message", {
        userId,
        email,
        message: data.message,
        timestamp: new Date().toISOString(),
      })
    })

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log(`WebSocket disconnected: ${email}`)
    })
  })

  return { io, engine }
}
