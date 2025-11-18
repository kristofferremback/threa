import { Server as SocketIOServer } from "socket.io"
import type { Server as HTTPServer } from "http"
import { createAdapter } from "@socket.io/redis-adapter"
import { workos } from "../routes/auth"
import { WORKOS_COOKIE_PASSWORD } from "../config"
import { parseCookies } from "../lib/cookie-utils"
import { logger } from "../lib/logger"
import { ensureUser, getDefaultChannel } from "../lib/users"
import { createMessage, getMessagesByChannel } from "../lib/messages"
import { pool } from "../lib/db"
import { createRedisClient, connectRedisClient } from "../lib/redis"
import type { RedisClientType } from "redis"

interface SocketData {
  userId: string
  email: string
}

export const createSocketIOServer = async (server: HTTPServer) => {
  const io = new SocketIOServer<any, any, any, SocketData>(server, {
    cors: {
      origin: ["http://localhost:3000", "http://localhost:3001"],
      credentials: true,
    },
  })

  let pubClient: RedisClientType | null = null
  let subClient: RedisClientType | null = null

  try {
    let errorOccurred = false
    const handleError = async (err: Error) => {
      if (!errorOccurred) {
        errorOccurred = true
        logger.error({ err }, "Redis error - disconnecting")

        try {
          await Promise.all([pubClient?.quit(), subClient?.quit()])
        } catch (err) {
          logger.error({ err }, "Error destroying Redis client")
        }
      }
    }

    pubClient = createRedisClient({ onError: handleError })
    subClient = pubClient.duplicate()
    subClient.on("error", handleError)

    await Promise.all([
      connectRedisClient(pubClient, "Socket.IO pub client"),
      connectRedisClient(subClient, "Socket.IO sub client"),
    ])

    io.adapter(createAdapter(pubClient, subClient))

    logger.info("Redis adapter connected for Socket.IO")
  } catch (error) {
    logger.warn("Redis not available - running without message broadcasting")

    try {
      await Promise.all([pubClient?.quit(), subClient?.quit()])
    } catch (err) {
      logger.error({ err }, "Error destroying Redis client")
    }
  }

  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie
      const cookies = parseCookies(cookieHeader || "")
      const sealedSession = cookies["wos_session"]

      if (!sealedSession) {
        logger.warn("No session cookie in Socket.IO connection")
        return next(new Error("No session cookie provided"))
      }

      const session = workos.userManagement.loadSealedSession({
        sessionData: sealedSession,
        cookiePassword: WORKOS_COOKIE_PASSWORD,
      })

      let authRes = await session.authenticate()
      
      // If authentication failed, try to refresh (handles expired access tokens)
      if (!authRes.authenticated) {
        try {
          const refreshResult = await session.refresh({ cookiePassword: WORKOS_COOKIE_PASSWORD })
          if (refreshResult.authenticated && refreshResult.user) {
            // Use refreshed user data
            socket.data.userId = refreshResult.user.id
            socket.data.email = refreshResult.user.email
            // Note: Can't update cookie in WebSocket handshake, but session is refreshed for this connection
            return next()
          }
        } catch (error) {
          logger.error({ err: error }, "Socket.IO session refresh error")
        }
        
        // If refresh failed, reject connection
        logger.warn({ reason: authRes.reason }, "Socket.IO auth failed")
        return next(new Error("Authentication failed"))
      }

      socket.data.userId = authRes.user.id
      socket.data.email = authRes.user.email

      next()
    } catch (error) {
      logger.error({ err: error }, "Socket.IO auth error")
      next(new Error("Authentication failed"))
    }
  })

  io.on("connection", async (socket) => {
    const userId = socket.data.userId
    const email = socket.data.email

    logger.info({ email, userId }, "Socket.IO connected")

    try {
      // Ensure user exists in database
      await ensureUser({
        id: userId,
        email,
        firstName: null,
        lastName: null,
      })

      // Get default channel
      const channelId = await getDefaultChannel()

      // Load recent messages with author info
      const messages = await getMessagesByChannel(channelId, 50)
      const messagesWithAuthors = await Promise.all(
        messages.map(async (msg) => {
          const userResult = await pool.query("SELECT email FROM users WHERE id = $1", [msg.author_id])
          const authorEmail = userResult.rows[0]?.email || "unknown"
          return {
            id: msg.id,
            userId: msg.author_id,
            email: authorEmail,
            message: msg.content,
            timestamp: msg.created_at.toISOString(),
          }
        })
      )
      socket.emit("messages", messagesWithAuthors)

      socket.emit("connected", {
        message: "Connected to Threa",
        channelId,
      })

      socket.on("message", async (data) => {
        try {
          logger.info({ email, data }, "Message received")

          // Persist message to database
          const message = await createMessage({
            channelId,
            authorId: userId,
            content: data.message,
          })

          // Broadcast to all clients
          io.emit("message", {
            id: message.id,
            userId,
            email,
            message: data.message,
            timestamp: message.created_at.toISOString(),
          })
        } catch (error) {
          logger.error({ err: error }, "Failed to process message")
          socket.emit("error", { message: "Failed to send message" })
        }
      })

      socket.on("disconnect", () => {
        logger.info({ email }, "Socket.IO disconnected")
      })
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize socket connection")
      socket.disconnect()
    }
  })

  return io
}
