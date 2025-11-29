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
import { queueEmbedding } from "../workers/embedding-worker"
import { AIUsageService } from "../services/ai-usage-service"
import { shutdownCoordinator } from "../index"

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

export interface SocketIOServerWithCleanup extends SocketIOServer {
  closeWithCleanup(): Promise<void>
}

export async function setupStreamWebSocket(
  httpServer: HTTPServer,
  pool: Pool,
  streamService: StreamService,
): Promise<SocketIOServerWithCleanup> {
  const authService = new AuthService()
  const aiUsageService = new AIUsageService(pool)

  // Create Socket.IO server
  const io = new SocketIOServer<any, any, any, SocketData>(httpServer, {
    cors: {
      origin: ["http://localhost:3000", "http://localhost:3001"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  }) as SocketIOServerWithCleanup

  // Setup Redis adapter for horizontal scaling
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379"
  const pubClient = new Redis(redisUrl)
  const subClient = pubClient.duplicate()
  const messageSubscriber = pubClient.duplicate()

  io.adapter(createAdapter(pubClient, subClient))

  // Add cleanup method that disconnects all clients and closes Redis clients properly
  io.closeWithCleanup = async () => {
    // First, disconnect all connected sockets (don't wait for clients to disconnect voluntarily)
    const connectedSockets = await io.fetchSockets()
    logger.info({ count: connectedSockets.length }, "Disconnecting all Socket.IO clients")
    for (const socket of connectedSockets) {
      socket.disconnect(true) // true = close the underlying connection
    }

    // Now close the server (should be quick since we already disconnected everyone)
    await new Promise<void>((resolve) => io.close(() => resolve()))

    // Clean up Redis clients
    await Promise.all([
      pubClient.quit(),
      subClient.quit(),
      messageSubscriber.quit(),
    ])
    logger.info("Socket.IO server and Redis clients closed")
  }
  logger.info("Redis adapter connected for Socket.IO")

  // Authentication middleware
  io.use(async (socket, next) => {
    // Reject new connections during shutdown
    if (shutdownCoordinator.isShuttingDown) {
      return next(new Error("Server is shutting down"))
    }

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
  // NOTE: When adding new event types, you must:
  // 1. Add the subscription here
  // 2. Add a handler in the switch statement below
  // 3. Handle in frontend hooks (useWorkspaceSocket, useStream, useBootstrap)
  await messageSubscriber.subscribe(
    // Stream events (messages)
    "event:stream_event.created",
    "event:stream_event.edited",
    "event:stream_event.deleted",
    // Stream lifecycle
    "event:stream.created",
    "event:stream.updated",
    "event:stream.archived",
    "event:stream.promoted",
    // Stream membership
    "event:stream.member_added",
    "event:stream.member_removed",
    // Workspace membership
    "event:workspace.member_added",
    "event:workspace.member_removed",
    "event:workspace.member_updated",
    // User profile
    "event:user.profile_updated",
    // Invitations
    "event:invitation.created",
    "event:invitation.accepted",
    "event:invitation.revoked",
    // Notifications & read state
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
            agent_id,
            content,
            mentions,
            is_crosspost,
            original_stream_id,
          } = event

          // Get actor or agent info
          let actorEmail = "unknown"
          let actorName: string | null = null
          let agentId: string | null = null
          let agentName: string | null = null

          if (agent_id) {
            // This is an agent message (e.g., Ariadne)
            agentId = agent_id
            const agentResult = await pool.query<{ name: string }>(
              sql`SELECT name FROM ai_personas WHERE id = ${agent_id}`,
            )
            agentName = agentResult.rows[0]?.name || "AI Assistant"
            actorName = agentName
            actorEmail = `${agentName?.toLowerCase().replace(/\s+/g, "")}@threa.ai`
          } else if (actor_id) {
            // This is a user message
            actorEmail = (await streamService.getUserEmail(actor_id)) || "unknown"
          }

          // Build event data for clients
          const eventData = {
            id: event_id,
            streamId: stream_id,
            eventType: event_type,
            actorId: actor_id,
            actorEmail,
            actorName,
            agentId,
            agentName,
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

          // Queue embedding job for message events (async, non-blocking)
          if (event_type === "message" && content) {
            try {
              const isAIEnabled = await aiUsageService.isAIEnabled(workspace_id)
              if (isAIEnabled) {
                // Get the text_message ID from the event
                const eventResult = await pool.query<{ content_id: string }>(
                  sql`SELECT content_id FROM stream_events WHERE id = ${event_id}`,
                )
                const textMessageId = eventResult.rows[0]?.content_id
                if (textMessageId) {
                  await queueEmbedding({
                    workspaceId: workspace_id,
                    textMessageId,
                    content,
                    eventId: event_id,
                  })
                  logger.debug({ event_id, textMessageId }, "Queued embedding job")
                }
              }
            } catch (err) {
              // Don't fail the broadcast if embedding queue fails
              logger.warn({ err, event_id }, "Failed to queue embedding job")
            }
          }

          // Update reply count for threads - emit to parent stream
          if (event_type === "message") {
            try {
              const streamResult = await pool.query<{
                stream_type: string
                parent_stream_id: string | null
                branched_from_event_id: string | null
              }>(
                sql`SELECT stream_type, parent_stream_id, branched_from_event_id
                    FROM streams WHERE id = ${stream_id}`,
              )
              const streamInfo = streamResult.rows[0]

              if (streamInfo?.stream_type === "thread" && streamInfo.parent_stream_id && streamInfo.branched_from_event_id) {
                // Count replies in this thread
                const countResult = await pool.query<{ count: string }>(
                  sql`SELECT COUNT(*) as count FROM stream_events
                      WHERE stream_id = ${stream_id}
                        AND event_type = 'message'
                        AND deleted_at IS NULL`,
                )
                const replyCount = parseInt(countResult.rows[0]?.count || "0", 10)

                // Emit to parent stream so channel view updates
                io.to(room.stream(workspace_id, streamInfo.parent_stream_id)).emit("replyCount:updated", {
                  eventId: streamInfo.branched_from_event_id,
                  replyCount,
                })
                logger.debug({ event_id: streamInfo.branched_from_event_id, replyCount }, "Reply count updated")
              }
            } catch (err) {
              logger.warn({ err, stream_id }, "Failed to update reply count")
            }
          }

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
          const { stream_id, workspace_id, stream_type, name, slug, visibility, creator_id, parent_stream_id, branched_from_event_id } = event

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

          // For threads, broadcast to parent stream and pending thread room
          if (stream_type === "thread" && parent_stream_id && branched_from_event_id) {
            const threadCreatedPayload = {
              threadId: stream_id,
              name,
              parentStreamId: parent_stream_id,
              branchedFromEventId: branched_from_event_id,
            }
            // Emit to parent stream (for reply count badges)
            io.to(room.stream(workspace_id, parent_stream_id)).emit("thread:created", threadCreatedPayload)
            // Emit to pending thread room (for users viewing the pending thread)
            io.to(room.stream(workspace_id, branched_from_event_id)).emit("thread:created", threadCreatedPayload)
            logger.debug({ stream_id, parent_stream_id, branched_from_event_id }, "Thread created broadcast to parent stream and pending thread")
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
          const {
            workspace_id,
            user_id,
            notification_type,
            stream_id,
            stream_name,
            stream_slug,
            event_id,
            actor_id,
            actor_email,
            actor_name,
            preview,
            id,
          } = event

          // Send to user's private room with all fields the frontend expects
          io.to(room.user(workspace_id, user_id)).emit("notification:new", {
            id,
            notificationType: notification_type,
            streamId: stream_id,
            streamName: stream_name,
            streamSlug: stream_slug,
            eventId: event_id,
            actorId: actor_id,
            actorEmail: actor_email,
            actorName: actor_name,
            preview,
            readAt: null,
            createdAt: new Date().toISOString(),
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

        // ========================================================================
        // Stream Updates & Archival
        // ========================================================================

        case "event:stream.updated": {
          const { stream_id, workspace_id, name, slug, description, topic, updated_by } = event

          // Broadcast to workspace (sidebar needs to update)
          io.to(room.workspace(workspace_id)).emit("stream:updated", {
            id: stream_id,
            name,
            slug,
            description,
            topic,
            updatedBy: updated_by,
          })

          // Also broadcast to the stream room (for header updates)
          io.to(room.stream(workspace_id, stream_id)).emit("stream:updated", {
            id: stream_id,
            name,
            slug,
            description,
            topic,
            updatedBy: updated_by,
          })

          logger.debug({ stream_id, name }, "Stream updated broadcast via Socket.IO")
          break
        }

        case "event:stream.archived": {
          const { stream_id, workspace_id, archived, archived_by } = event

          // Broadcast to workspace (sidebar needs to update)
          io.to(room.workspace(workspace_id)).emit("stream:archived", {
            id: stream_id,
            archived,
            archivedBy: archived_by,
          })

          // Also broadcast to the stream room (kick users out if archived)
          io.to(room.stream(workspace_id, stream_id)).emit("stream:archived", {
            id: stream_id,
            archived,
            archivedBy: archived_by,
          })

          logger.debug({ stream_id, archived }, "Stream archived status broadcast via Socket.IO")
          break
        }

        // ========================================================================
        // Workspace Membership Events
        // ========================================================================

        case "event:workspace.member_added": {
          const { workspace_id, user_id, user_email, user_name, role, added_by_user_id } = event

          // Broadcast to entire workspace so everyone sees the new member
          io.to(room.workspace(workspace_id)).emit("workspace:member:added", {
            userId: user_id,
            userEmail: user_email,
            userName: user_name,
            role,
            addedByUserId: added_by_user_id,
          })

          logger.debug({ workspace_id, user_id }, "Workspace member added broadcast via Socket.IO")
          break
        }

        case "event:workspace.member_removed": {
          const { workspace_id, user_id, user_email, removed_by_user_id } = event

          // Broadcast to entire workspace
          io.to(room.workspace(workspace_id)).emit("workspace:member:removed", {
            userId: user_id,
            userEmail: user_email,
            removedByUserId: removed_by_user_id,
          })

          logger.debug({ workspace_id, user_id }, "Workspace member removed broadcast via Socket.IO")
          break
        }

        case "event:workspace.member_updated": {
          const { workspace_id, user_id, role, status, updated_by_user_id } = event

          // Broadcast to entire workspace
          io.to(room.workspace(workspace_id)).emit("workspace:member:updated", {
            userId: user_id,
            role,
            status,
            updatedByUserId: updated_by_user_id,
          })

          logger.debug({ workspace_id, user_id }, "Workspace member updated broadcast via Socket.IO")
          break
        }

        // ========================================================================
        // User Profile Events
        // ========================================================================

        case "event:user.profile_updated": {
          const { workspace_id, user_id, display_name, title, avatar_url } = event

          // Broadcast to entire workspace so everyone sees the profile update
          io.to(room.workspace(workspace_id)).emit("user:profile:updated", {
            userId: user_id,
            displayName: display_name,
            title,
            avatarUrl: avatar_url,
          })

          logger.debug({ workspace_id, user_id }, "User profile updated broadcast via Socket.IO")
          break
        }

        // ========================================================================
        // Invitation Events
        // ========================================================================

        case "event:invitation.created": {
          const { invitation_id, workspace_id, email, role, invited_by_user_id, invited_by_email, expires_at } = event

          // Broadcast to workspace admins (they should see pending invitations)
          io.to(room.workspace(workspace_id)).emit("invitation:created", {
            id: invitation_id,
            email,
            role,
            invitedByUserId: invited_by_user_id,
            invitedByEmail: invited_by_email,
            expiresAt: expires_at,
          })

          logger.debug({ invitation_id, email }, "Invitation created broadcast via Socket.IO")
          break
        }

        case "event:invitation.accepted": {
          const { invitation_id, workspace_id, user_id, user_email, user_name, role } = event

          // Broadcast to workspace (new member joined via invitation)
          io.to(room.workspace(workspace_id)).emit("invitation:accepted", {
            id: invitation_id,
            userId: user_id,
            userEmail: user_email,
            userName: user_name,
            role,
          })

          logger.debug({ invitation_id, user_id }, "Invitation accepted broadcast via Socket.IO")
          break
        }

        case "event:invitation.revoked": {
          const { invitation_id, workspace_id, email, revoked_by_user_id } = event

          // Broadcast to workspace admins
          io.to(room.workspace(workspace_id)).emit("invitation:revoked", {
            id: invitation_id,
            email,
            revokedByUserId: revoked_by_user_id,
          })

          logger.debug({ invitation_id, email }, "Invitation revoked broadcast via Socket.IO")
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
