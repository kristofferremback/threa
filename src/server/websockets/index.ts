import { Server as SocketIOServer } from "socket.io"
import type { Server as HTTPServer } from "http"
import { createAdapter } from "@socket.io/redis-adapter"
import { AuthService } from "../services/auth-service"
import { UserService } from "../services/user-service"
import { ChatService } from "../services/chat-service"
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
  chatService,
  redisPubClient,
  redisSubClient,
}: {
  server: HTTPServer
  pool: Pool
  authService: AuthService
  userService: UserService
  chatService: ChatService
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
        const { id, channel_id, author_id, content, workspace_id } = event

        // Get author email and broadcast via Socket.IO
        const email = await chatService.getUserEmail(author_id)
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

        const channel = await chatService.getChannelById(channel_id)

        // Emit to workspace room (lightweight notification for unread counts)
        io.to(`ws:${workspace_id}`).emit("notification", {
          type: "message",
          channelId: channel_id,
          channelSlug: channel?.slug,
          conversationId: event.conversation_id,
        })

        // Emit to ID-based room (full message for active viewers)
        io.to(`chan:${channel_id}`).emit("message", messageData)

        // Emit to conversation room if exists
        if (event.conversation_id) {
          io.to(`conv:${event.conversation_id}`).emit("message", messageData)
        }

        // Emit to thread root if replying (handles first reply case)
        if (event.reply_to_message_id) {
          io.to(`thread:${event.reply_to_message_id}`).emit("message", messageData)

          // Emit reply count update to channel viewers so they can update the parent message's indicator
          logger.info({ reply_to_message_id: event.reply_to_message_id, channel_id, conversation_id: event.conversation_id }, "About to get reply count")
          const replyCount = await chatService.getReplyCount(event.reply_to_message_id)
          logger.info({ replyCount, messageId: event.reply_to_message_id, room: `chan:${channel_id}` }, "Emitting replyCountUpdate to channel")
          
          // Emit to channel room (for channel view)
          io.to(`chan:${channel_id}`).emit("replyCountUpdate", {
            messageId: event.reply_to_message_id,
            replyCount,
          })

          // Get the parent message to find which thread it belongs to (for branched conversations)
          const parentMessage = await chatService.getMessageById(event.reply_to_message_id)
          if (parentMessage) {
            // If parent message is itself a reply, emit to its parent's thread room
            // so viewers of that thread see the reply count update
            if (parentMessage.reply_to_message_id) {
              io.to(`thread:${parentMessage.reply_to_message_id}`).emit("replyCountUpdate", {
                messageId: event.reply_to_message_id,
                replyCount,
              })
            }
            
            // Also emit to the parent's conversation room if it exists
            if (parentMessage.conversation_id) {
              io.to(`conv:${parentMessage.conversation_id}`).emit("replyCountUpdate", {
                messageId: event.reply_to_message_id,
                replyCount,
              })
            }
          }

          // Also emit to the new message's conversation room (if exists)
          if (event.conversation_id) {
            io.to(`conv:${event.conversation_id}`).emit("replyCountUpdate", {
              messageId: event.reply_to_message_id,
              replyCount,
            })
          }
        }
        logger.debug({ message_id: id, channel_id }, "Message broadcast via Socket.IO")
      } catch (error) {
        logger.error({ err: error }, "Failed to process Redis message event")
      }
    })()
  })

  // Subscribe to message edit events
  await messageSubscriber.subscribe("event:message.edited", (message: string) => {
    ;(async () => {
      try {
        const event = JSON.parse(message)
        const { id, channel_id, conversation_id, content, updated_at, workspace_id } = event

        const editData = {
          id,
          content,
          updatedAt: updated_at,
        }

        // Get channel info for slug-based rooms
        const channel = await chatService.getChannelById(channel_id)

        // Emit to channel rooms
        io.to(`chan:${channel_id}`).emit("messageEdited", editData)

        // Emit to conversation room if exists
        if (conversation_id) {
          io.to(`conv:${conversation_id}`).emit("messageEdited", editData)
        }

        logger.debug({ message_id: id }, "Message edit broadcast via Socket.IO")
      } catch (error) {
        logger.error({ err: error }, "Failed to process Redis message.edited event")
      }
    })()
  })

  // Subscribe to conversation creation events
  await messageSubscriber.subscribe("event:conversation.created", (message: string) => {
    ;(async () => {
      try {
        const event = JSON.parse(message)
        const { id, root_message_id, channel_ids, workspace_id } = event

        const eventData = {
          type: "conversation_created",
          conversationId: id,
          rootMessageId: root_message_id,
          channelIds: channel_ids,
          timestamp: event.created_at,
        }

        // Broadcast to workspace room
        io.to(`ws:${workspace_id}`).emit("notification", {
          type: "conversation_created",
          conversationId: id,
          rootMessageId: root_message_id,
        })

        // Broadcast to all involved channels so they can update the root message UI
        for (const channelId of channel_ids) {
          io.to(`chan:${channelId}`).emit("conversation_created", eventData)
        }

        // Also emit to the root message thread room if anyone is listening
        io.to(`thread:${root_message_id}`).emit("conversation_created", eventData)

        logger.debug({ conversation_id: id, channels: channel_ids }, "Conversation created broadcast via Socket.IO")
      } catch (error) {
        logger.error({ err: error }, "Failed to process Redis conversation.created event")
      }
    })()
  })

  // Subscribe to channel member added events
  await messageSubscriber.subscribe("event:channel.member_added", (message: string) => {
    ;(async () => {
      try {
        const event = JSON.parse(message)
        const { channelId, workspaceId, userId, addedByUserId, eventType } = event

        // Get channel details to send to the user
        const channel = await chatService.getChannelById(channelId)
        if (!channel) {
          logger.warn({ channelId }, "Channel not found for member_added event")
          return
        }

        // Notify the added user so they can update their channel list
        io.to(`user:${userId}`).emit("channelMemberAdded", {
          channel: {
            id: channel.id,
            name: channel.name,
            slug: channel.slug,
            description: channel.description,
            topic: channel.topic,
            visibility: channel.visibility,
            is_member: true,
            unread_count: 0,
            last_read_at: new Date().toISOString(),
            notify_level: "default",
          },
          addedByUserId,
          eventType,
        })

        logger.debug({ channel_id: channelId, user_id: userId }, "Channel member added broadcast via Socket.IO")
      } catch (error) {
        logger.error({ err: error }, "Failed to process Redis channel.member_added event")
      }
    })()
  })

  // Subscribe to channel member removed events
  await messageSubscriber.subscribe("event:channel.member_removed", (message: string) => {
    ;(async () => {
      try {
        const event = JSON.parse(message)
        const { channelId, channelName, workspaceId, userId, removedByUserId } = event

        // Notify the removed user directly
        io.to(`user:${userId}`).emit("channelMemberRemoved", {
          channelId,
          channelName,
          removedByUserId,
        })

        // Also emit to the channel room so other members can update their UI
        io.to(`chan:${channelId}`).emit("channelMemberRemoved", {
          channelId,
          userId,
          removedByUserId,
        })

        logger.debug({ channel_id: channelId, user_id: userId }, "Channel member removed broadcast via Socket.IO")
      } catch (error) {
        logger.error({ err: error }, "Failed to process Redis channel.member_removed event")
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

    // Ensure user exists
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

    // Join the workspace room for notifications
    socket.join(`ws:${workspaceId}`)

    // Join the user's private room for direct notifications
    socket.join(`user:${userId}`)

    // Emit connected event with workspace info and user ID
    socket.emit("connected", {
      message: "Connected to Threa",
      workspaceId,
    })

    // Emit authenticated event with user info for frontend
    socket.emit("authenticated", {
      userId,
      email,
    })

    // NOTE: WebSocket is only for:
    // - Real-time push (receiving messages via Redis subscription)
    // - Ephemeral events (typing indicators, read cursors)
    // - Room management (join/leave)
    // All resource fetching (messages, threads, etc.) is done via HTTP

    // Room management - client joins/leaves rooms as needed
    socket.on("join", (room: string) => {
      logger.debug({ userId, room }, "Joining room")
      socket.join(room)
    })

    socket.on("leave", (room: string) => {
      logger.debug({ userId, room }, "Leaving room")
      socket.leave(room)
    })

    // Handle read receipts (ephemeral)
    socket.on("read_cursor", async (data: { channelId?: string; conversationId?: string; messageId: string }) => {
      try {
        if (data.channelId) {
          await chatService.updateChannelReadCursor(data.channelId, userId, data.messageId)
        } else if (data.conversationId) {
          await chatService.updateConversationReadCursor(data.conversationId, userId, data.messageId)
        }
      } catch (error) {
        logger.error({ err: error }, "Failed to update read cursor")
      }
    })

    // Handle typing indicators
    socket.on("typing", (data: { channelId?: string; conversationId?: string }) => {
      if (data.channelId) {
        socket.to(`chan:${data.channelId}`).emit("user_typing", { userId, email })
      } else if (data.conversationId) {
        socket.to(`conv:${data.conversationId}`).emit("user_typing", { userId, email })
      }
    })

    socket.on("disconnect", () => {
      logger.info({ email }, "Socket.IO disconnected")
    })
  })

  return io
}
