import { Server as SocketIOServer } from "socket.io"
import type { Server as HTTPServer } from "http"
import { createAdapter } from "@socket.io/redis-adapter"
import { AuthService } from "../services/auth-service"
import { UserService } from "../services/user-service"
import { MessageService } from "../services/messages"
import { ConversationService } from "../services/conversation-service"
import { WorkspaceService } from "../services/workspace-service"
import { parseCookies } from "../lib/cookies"
import { logger } from "../lib/logger"
import { createRedisClient, connectRedisClient, type RedisClient } from "../lib/redis"
import { Pool } from "pg"

interface SocketData {
  userId: string
  email: string
}

export const createSocketIOServer = async ({
  server,
  pool,
  authService,
  userService,
  messageService,
  conversationService,
  workspaceService,
  redisPubClient,
  redisSubClient,
}: {
  server: HTTPServer
  pool: Pool
  authService: AuthService
  userService: UserService
  messageService: MessageService
  conversationService: ConversationService
  workspaceService: WorkspaceService
  redisPubClient: RedisClient
  redisSubClient: RedisClient
}) => {
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
        const messageData = {
          id,
          userId: author_id,
          email: email || "unknown",
          message: content,
          timestamp: new Date().toISOString(),
          channelId: channel_id,
          conversationId: event.conversation_id,
          replyToMessageId: event.reply_to_message_id,
        }

        // Emit to channel
        io.to(`channel:${channel_id}`).emit("message", messageData)

        // Emit to conversation if exists
        if (event.conversation_id) {
          io.to(`conversation:${event.conversation_id}`).emit("message", messageData)
        }

        // Emit to thread root if replying (handles first reply case)
        if (event.reply_to_message_id) {
          io.to(`thread:${event.reply_to_message_id}`).emit("message", messageData)
        }

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

    // Get user's workspace from workspace_members
    const workspaceMemberResult = await pool.query(
      "SELECT workspace_id FROM workspace_members WHERE user_id = $1 LIMIT 1",
      [userId],
    )

    if (workspaceMemberResult.rows.length === 0) {
      logger.error({ userId }, "User is not a member of any workspace")
      socket.emit("error", { message: "User is not a member of any workspace" })
      socket.disconnect()
      return
    }

    const workspaceId = workspaceMemberResult.rows[0].workspace_id

    // Get or create default channel for the workspace
    const channelId = await workspaceService.getOrCreateDefaultChannel(workspaceId)

    // Load recent messages
    const messagesWithAuthors = await messageService.getMessagesWithAuthors(channelId, 50)
    socket.emit("messages", messagesWithAuthors)
    socket.emit("connected", { message: "Connected to Threa", channelId })

    // Handle incoming messages
    // Message flow: persist to PostgreSQL -> outbox NOTIFY -> Redis publish -> Socket.IO emit
    socket.on(
      "message",
      async (data: { message: string; replyToMessageId?: string; conversationId?: string; channelIds?: string[] }) => {
        try {
          // Get workspace ID for channel
          const workspaceId = await userService.getWorkspaceIdForChannel(channelId)
          if (!workspaceId) {
            throw new Error("Failed to get workspace ID for channel")
          }

          let conversationId = data.conversationId || null
          let replyToMessageId = data.replyToMessageId || null

          // If replying to a message, check if conversation exists or create one
          if (replyToMessageId && !conversationId) {
            // Get the message being replied to
            const allMessages = await messageService.getMessagesByChannel(channelId, 1000, 0) // Get enough to find the message
            const targetMessage = allMessages.find((m) => m.id === replyToMessageId)

            if (targetMessage) {
              if (targetMessage.conversation_id) {
                // Message is already in a conversation, use that
                conversationId = targetMessage.conversation_id
              } else {
                // Create new conversation from this reply
                // The root message is the one being replied to
                const conversation = await conversationService.createConversation(
                  workspaceId,
                  replyToMessageId,
                  channelId,
                  data.channelIds || [],
                )
                conversationId = conversation.id
              }
            }
          }

          // Persist message to PostgreSQL (creates outbox event)
          // The outbox listener will publish to Redis, which triggers Socket.IO emit
          await messageService.createMessage({
            workspaceId,
            channelId,
            authorId: userId,
            content: data.message,
            conversationId,
            replyToMessageId,
          })

          // If this is a new conversation and has multiple channels, add them
          if (conversationId && data.channelIds && data.channelIds.length > 0) {
            for (const additionalChannelId of data.channelIds) {
              if (additionalChannelId !== channelId) {
                await conversationService.addChannelToConversation(conversationId, additionalChannelId)
              }
            }
          }

          // No direct emit - message will be broadcast via Redis subscription
        } catch (error) {
          logger.error({ err: error }, "Failed to process message")
          socket.emit("error", { message: "Failed to send message" })
        }
      },
    )

    socket.on("join", (room: string) => {
      logger.debug({ userId, room }, "Joining room")
      socket.join(room)
    })

    socket.on("leave", (room: string) => {
      logger.debug({ userId, room }, "Leaving room")
      socket.leave(room)
    })

    // Handle loading conversation messages
    socket.on("loadThread", async (data: { messageId: string }) => {
      try {
        const targetMessage = await messageService.getMessageById(data.messageId)
        if (!targetMessage) {
          socket.emit("error", { message: "Message not found" })
          return
        }

        let conversationMessages: any[] = []

        if (targetMessage.conversation_id) {
          conversationMessages = await messageService.getMessagesByConversation(targetMessage.conversation_id)
        } else {
          // If no conversation yet, the thread is just the message itself acting as root
          conversationMessages = [targetMessage]
        }

        const messagesWithAuthors = await Promise.all(
          conversationMessages.map(async (msg) => {
            const email = await userService.getUserEmail(msg.author_id)
            return {
              id: msg.id,
              userId: msg.author_id,
              email: email || "unknown",
              message: msg.content,
              timestamp: msg.created_at.toISOString(),
              conversationId: msg.conversation_id,
              replyToMessageId: msg.reply_to_message_id,
            }
          }),
        )

        // Fetch ancestors
        const ancestors = await messageService.getMessageAncestors(data.messageId)
        const ancestorsWithAuthors = await Promise.all(
          ancestors.map(async (msg) => {
            const email = await userService.getUserEmail(msg.author_id)
            return {
              id: msg.id,
              userId: msg.author_id,
              email: email || "unknown",
              message: msg.content,
              timestamp: msg.created_at.toISOString(),
              conversationId: msg.conversation_id,
              replyToMessageId: msg.reply_to_message_id,
            }
          }),
        )

        socket.emit("threadMessages", {
          rootMessageId: data.messageId,
          conversationId: targetMessage.conversation_id,
          messages: messagesWithAuthors,
          ancestors: ancestorsWithAuthors,
        })
      } catch (error) {
        logger.error({ err: error }, "Failed to load thread")
        socket.emit("error", { message: "Failed to load thread" })
      }
    })

    socket.on("disconnect", () => {
      logger.info({ email }, "Socket.IO disconnected")
    })
  })

  return io
}
