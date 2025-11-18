import { Server as SocketIOServer } from "socket.io"
import type { Server as HTTPServer } from "http"
import { createClient } from "redis"
import { createAdapter } from "@socket.io/redis-adapter"
import { workos } from "../routes/auth"
import { WORKOS_COOKIE_PASSWORD, REDIS_URL } from "../config"
import { parseCookies } from "../lib/cookie-utils"
import { logger } from "../lib/logger"

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

  let pubClient: ReturnType<typeof createClient> | null = null
  let subClient: ReturnType<typeof createClient> | null = null

  try {
    pubClient = createClient({ url: REDIS_URL })
    subClient = pubClient.duplicate()

    let errorOccurred = false
    const handleError = async (err: Error) => {
      if (!errorOccurred) {
        errorOccurred = true
        logger.error({ err }, "Redis error - disconnecting")

        try {
          await Promise.all([pubClient?.destroy(), subClient?.destroy()])
        } catch (err) {
          logger.error({ err }, "Error destroying Redis client")
        }
      }
    }

    pubClient.on("error", handleError)
    subClient.on("error", handleError)

    await Promise.all([pubClient.connect(), subClient.connect()])

    await pubClient.ping()
    await subClient.ping()

    io.adapter(createAdapter(pubClient, subClient))

    logger.info("Redis adapter connected for Socket.IO")
  } catch (error) {
    logger.warn("Redis not available - running without message broadcasting")

    try {
      await pubClient?.destroy()
      await subClient?.destroy()
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

      const authRes = await session.authenticate()
      if (!authRes.authenticated) {
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

  io.on("connection", (socket) => {
    const userId = socket.data.userId
    const email = socket.data.email

    logger.info({ email, userId }, "Socket.IO connected")

    socket.emit("connected", {
      message: "Connected to Threa",
    })

    socket.on("message", (data) => {
      logger.info({ email, data }, "Message received")

      io.emit("message", {
        userId,
        email,
        message: data.message,
        timestamp: new Date().toISOString(),
      })
    })

    socket.on("disconnect", () => {
      logger.info({ email }, "Socket.IO disconnected")
    })
  })

  return io
}
