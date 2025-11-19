import { Server as SocketIOServer } from "socket.io"
import type { Server as HTTPServer } from "http"
import { createAdapter } from "@socket.io/redis-adapter"
import { AuthService } from "../lib/auth-service"
import { UserService } from "../lib/user-service"
import { MessageService } from "../lib/messages"
import { parseCookies } from "../lib/cookie-utils"
import { logger } from "../lib/logger"
import { createRedisClient, connectRedisClient, type RedisClient } from "../lib/redis"

interface SocketData {
  userId: string
  email: string
}

export const createSocketIOServer = async (
  server: HTTPServer,
  authService: AuthService,
  userService: UserService,
  messageService: MessageService,
  redisPubClient: RedisClient,
  redisSubClient: RedisClient,
) => {
  const io = new SocketIOServer<any, any, any, SocketData>(server, {
    cors: {
      origin: ["http://localhost:3000", "http://localhost:3001"],
      credentials: true,
    },
  })

  // Set up Redis adapter for Socket.IO cross-server communication
  io.adapter(createAdapter(redisPubClient, redisSubClient))
  logger.info("Redis adapter connected for Socket.IO")

  // Create a separate Redis subscriber for outbox events
  // This listens to messages published by the outbox listener
  const messageSubscriber = createRedisClient({
    onError: (err: Error) => {
      logger.error({ err }, "Redis message subscriber error")
    },
  })
  await connectRedisClient(messageSubscriber, "Message subscriber")

  // Subscribe to Redis events for message broadcasting
  // Message flow: persist to PostgreSQL -> outbox NOTIFY -> Redis publish -> Socket.IO emit
  await messageSubscriber.subscribe("event:message.created", (message: string) => {
    // Handle message asynchronously
    ;(async () => {
      try {
        const event = JSON.parse(message)
        const { id, channel_id, author_id, content } = event

        // Get author email and broadcast via Socket.IO
        const email = await userService.getUserEmail(author_id)
        io.emit("message", {
          id,
          userId: author_id,
          email: email || "unknown",
          message: content,
          timestamp: new Date().toISOString(),
        })

        logger.debug({ message_id: id, channel_id }, "Message broadcast via Socket.IO")
      } catch (error) {
        logger.error({ err: error }, "Failed to process Redis message event")
      }
    })()
  })

  logger.info("Subscribed to Redis message events")

  // Authentication middleware
  io.use(async (socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie
    const cookies = parseCookies(cookieHeader || "")
    const sealedSession = cookies["wos_session"]

    if (!sealedSession) {
      return next(new Error("No session cookie provided"))
    }

    const result = await authService.authenticateSession(sealedSession)

    if (result.success && result.user) {
      socket.data.userId = result.user.id
      socket.data.email = result.user.email
      if (result.refreshed) {
        logger.debug({ email: result.user.email }, "Socket.IO session refreshed")
      }
      return next()
    }

    logger.warn({ reason: result.reason }, "Socket.IO auth failed")
    return next(new Error("Authentication failed"))
  })

  io.on("connection", async (socket) => {
    const userId = socket.data.userId
    const email = socket.data.email

    logger.info({ email, userId }, "Socket.IO connected")

    // Ensure user exists and get default channel
    await userService.ensureUser({
      id: userId,
      email,
      firstName: null,
      lastName: null,
    })

    const channelId = await userService.getDefaultChannel()

    // Load recent messages
    const messagesWithAuthors = await messageService.getMessagesWithAuthors(channelId, 50)
    socket.emit("messages", messagesWithAuthors)
    socket.emit("connected", { message: "Connected to Threa", channelId })

    // Handle incoming messages
    // Message flow: persist to PostgreSQL -> outbox NOTIFY -> Redis publish -> Socket.IO emit
    socket.on("message", async (data: { message: string }) => {
      try {
        // Persist message to PostgreSQL (creates outbox event)
        // The outbox listener will publish to Redis, which triggers Socket.IO emit
        await messageService.createMessage({
          channelId,
          authorId: userId,
          content: data.message,
        })
        // No direct emit - message will be broadcast via Redis subscription
      } catch (error) {
        logger.error({ err: error }, "Failed to process message")
        socket.emit("error", { message: "Failed to send message" })
      }
    })

    socket.on("disconnect", () => {
      logger.info({ email }, "Socket.IO disconnected")
    })
  })

  return io
}
