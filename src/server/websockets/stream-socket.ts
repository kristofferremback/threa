import { Server as SocketIOServer, Socket } from "socket.io"
import { Server as HTTPServer } from "http"
import Redis from "ioredis"
import { createAdapter } from "@socket.io/redis-adapter"
import { Pool } from "pg"
import { sql } from "../lib/db"
import { logger } from "../lib/logger"
import { StreamService } from "../services/stream-service"
import { AuthService } from "../services/auth-service"
import { parseCookies } from "../lib/cookies"

interface SocketData {
  userId: string
  email: string
}

// Room name builders
export const room = {
  // Per-stream events (new events, edits, typing)
  stream: (workspaceId: string, streamId: string) => `ws:${workspaceId}:stream:${streamId}`,

  // Workspace-wide events (sidebar badges, new streams)
  workspace: (workspaceId: string) => `ws:${workspaceId}:workspace`,

  // User-specific events (activity feed, membership changes, read sync)
  user: (workspaceId: string, userId: string) => `ws:${workspaceId}:user:${userId}`,
}

export async function setupStreamWebSocket(
  httpServer: HTTPServer,
  pool: Pool,
  streamService: StreamService,
): Promise<SocketIOServer> {
  const authService = new AuthService()

  // Create Socket.IO server
  const io = new SocketIOServer<any, any, any, SocketData>(httpServer, {
    cors: {
      origin: ["http://localhost:3000", "http://localhost:3001"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  })

  // Setup Redis adapter for horizontal scaling
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379"
  const pubClient = new Redis(redisUrl)
  const subClient = pubClient.duplicate()
  const messageSubscriber = pubClient.duplicate()

  io.adapter(createAdapter(pubClient, subClient))
  logger.info("Redis adapter connected for Socket.IO")

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

  // ==========================================================================
  // Redis Event Subscriptions (Outbox pattern)
  // ==========================================================================

  // Subscribe to channels
  await messageSubscriber.subscribe(
    "event:stream_event.created",
    "event:stream_event.edited",
    "event:stream_event.deleted",
    "event:stream.created",
    "event:stream.promoted",
    "event:stream.member_added",
    "event:stream.member_removed",
    "event:notification.created",
    "event:read_cursor.updated",
  )

  // Handle messages from subscribed channels
  messageSubscriber.on("message", async (channel: string, message: string) => {
    try {
      const event = JSON.parse(message)

      switch (channel) {
        case "event:stream_event.created": {
          const {
            event_id,
            stream_id,
            workspace_id,
            stream_slug,
            event_type,
            actor_id,
            content,
            mentions,
            is_crosspost,
            original_stream_id,
          } = event

          // Get actor info
          const email = await streamService.getUserEmail(actor_id)

          // Build event data for clients
          const eventData = {
            id: event_id,
            streamId: stream_id,
            eventType: event_type,
            actorId: actor_id,
            actorEmail: email || "unknown",
            content,
            mentions,
            createdAt: new Date().toISOString(),
            isCrosspost: is_crosspost,
            originalStreamId: original_stream_id,
          }

          // Emit to the stream room
          io.to(room.stream(workspace_id, stream_id)).emit("event", eventData)

          // Emit lightweight notification to workspace (for sidebar badges)
          io.to(room.workspace(workspace_id)).emit("notification", {
            type: "event",
            streamId: stream_id,
            streamSlug: stream_slug,
            actorId: actor_id,
          })

          logger.debug({ event_id, stream_id }, "Stream event broadcast via Socket.IO")
          break
        }

        case "event:stream_event.edited": {
          const { event_id, stream_id, workspace_id, content, edited_at } = event

          io.to(room.stream(workspace_id, stream_id)).emit("event:edited", {
            id: event_id,
            content,
            editedAt: edited_at,
          })

          logger.debug({ event_id, stream_id }, "Event edit broadcast via Socket.IO")
          break
        }

        case "event:stream_event.deleted": {
          const { event_id, stream_id, workspace_id } = event

          io.to(room.stream(workspace_id, stream_id)).emit("event:deleted", {
            id: event_id,
          })

          logger.debug({ event_id, stream_id }, "Event delete broadcast via Socket.IO")
          break
        }

        case "event:stream.created": {
          const { stream_id, workspace_id, stream_type, name, slug, visibility, creator_id } = event

          // For public channels, broadcast to workspace
          if (visibility === "public" && stream_type === "channel") {
            io.to(room.workspace(workspace_id)).emit("stream:created", {
              id: stream_id,
              streamType: stream_type,
              name,
              slug,
              visibility,
              creatorId: creator_id,
            })
          }

          logger.debug({ stream_id }, "Stream created broadcast via Socket.IO")
          break
        }

        case "event:stream.promoted": {
          const { stream_id, workspace_id, new_type, new_name, new_slug, promoted_by } = event

          io.to(room.workspace(workspace_id)).emit("stream:promoted", {
            id: stream_id,
            newType: new_type,
            newName: new_name,
            newSlug: new_slug,
            promotedBy: promoted_by,
          })

          logger.debug({ stream_id, new_type }, "Stream promoted broadcast via Socket.IO")
          break
        }

        case "event:stream.member_added": {
          const { stream_id, stream_name, stream_slug, workspace_id, user_id, added_by_user_id } = event

          // Notify the user who was added
          io.to(room.user(workspace_id, user_id)).emit("stream:member:added", {
            streamId: stream_id,
            streamName: stream_name,
            streamSlug: stream_slug,
            addedByUserId: added_by_user_id,
          })

          logger.debug({ stream_id, user_id }, "Member added broadcast via Socket.IO")
          break
        }

        case "event:stream.member_removed": {
          const { stream_id, stream_name, workspace_id, user_id, removed_by_user_id } = event

          // Notify the user who was removed
          io.to(room.user(workspace_id, user_id)).emit("stream:member:removed", {
            streamId: stream_id,
            streamName: stream_name,
            removedByUserId: removed_by_user_id,
          })

          logger.debug({ stream_id, user_id }, "Member removed broadcast via Socket.IO")
          break
        }

        case "event:notification.created": {
          const { workspace_id, user_id, notification_type, stream_id, event_id, actor_id, preview, id } = event

          // Send to user's private room
          io.to(room.user(workspace_id, user_id)).emit("notification:new", {
            id,
            type: notification_type,
            streamId: stream_id,
            eventId: event_id,
            actorId: actor_id,
            preview,
          })

          logger.debug({ notification_id: id, user_id, type: notification_type }, "Notification broadcast")
          break
        }

        case "event:read_cursor.updated": {
          const { stream_id, workspace_id, user_id, event_id } = event

          // Notify user's other devices
          io.to(room.user(workspace_id, user_id)).emit("readCursor:updated", {
            streamId: stream_id,
            eventId: event_id,
          })

          logger.debug({ stream_id, user_id }, "Read cursor update broadcast")
          break
        }
      }
    } catch (error) {
      logger.error({ err: error, channel }, "Failed to process Redis message")
    }
  })

  // ==========================================================================
  // Client Connection Handling
  // ==========================================================================

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId as string | undefined
    const email = socket.data.email as string | undefined
    let workspaceId: string | null = null
    const queuedJoins: string[] = []
    let setupComplete = false

    // Register handlers immediately to avoid race conditions
    socket.on("join", (roomName: string) => {
      if (setupComplete && workspaceId) {
        logger.debug({ userId, room: roomName }, "Client joining room")
        socket.join(roomName)
      } else {
        logger.debug({ userId, room: roomName }, "Queueing room join")
        queuedJoins.push(roomName)
      }
    })

    socket.on("leave", (roomName: string) => {
      logger.debug({ userId, room: roomName }, "Leaving room")
      socket.leave(roomName)
    })

    socket.on("typing", (data: { streamId: string }) => {
      if (workspaceId && data.streamId) {
        socket.to(room.stream(workspaceId, data.streamId)).emit("typing", {
          streamId: data.streamId,
          userId,
          email,
        })
      }
    })

    socket.on("disconnect", () => {
      logger.debug({ userId }, "Client disconnected")
    })

    // --- Async setup ---

    if (!userId) {
      logger.warn("Socket connection without userId, disconnecting")
      socket.disconnect()
      return
    }

    try {
      // Get user's workspace
      const workspaceResult = await pool.query<{ workspace_id: string }>(
        sql`SELECT workspace_id FROM workspace_members
            WHERE user_id = ${userId} AND status = 'active'
            LIMIT 1`,
      )

      if (workspaceResult.rows.length === 0) {
        logger.warn({ userId }, "User not in any workspace, disconnecting")
        socket.disconnect()
        return
      }

      workspaceId = workspaceResult.rows[0].workspace_id

      // Auto-join workspace and user rooms
      socket.join(room.workspace(workspaceId))
      socket.join(room.user(workspaceId, userId))

      // Setup complete - process any pending joins
      setupComplete = true
      for (const roomName of queuedJoins) {
        logger.debug({ userId, room: roomName }, "Processing queued room join")
        socket.join(roomName)
      }

      // Emit connected event with workspace info
      socket.emit("connected", {
        message: "Connected to Threa",
        workspaceId,
      })

      // Emit authenticated event with user info
      socket.emit("authenticated", {
        userId,
        email,
      })

      logger.info({ userId, workspaceId, email }, "Socket connected and joined workspace")
    } catch (error) {
      logger.error({ err: error, userId }, "Error during socket setup")
      socket.disconnect()
    }
  })

  logger.info("Stream WebSocket server initialized")

  return io
}
