import { Pool } from "pg"
import { sql } from "../lib/db"
import { logger } from "../lib/logger"
import { generateId } from "../lib/id"
import { createValidSlug } from "../../shared/slug"

// ============================================================================
// Types
// ============================================================================

export type StreamType = "channel" | "thread" | "dm" | "incident"
export type StreamVisibility = "public" | "private" | "inherit"
export type StreamStatus = "active" | "archived" | "resolved"
export type EventType = "message" | "shared" | "member_joined" | "member_left" | "thread_started" | "poll" | "file"
export type NotifyLevel = "all" | "mentions" | "muted" | "default"
export type MemberRole = "owner" | "admin" | "member"

export interface Stream {
  id: string
  workspaceId: string
  streamType: StreamType
  name: string | null
  slug: string | null
  description: string | null
  topic: string | null
  parentStreamId: string | null
  branchedFromEventId: string | null
  visibility: StreamVisibility
  status: StreamStatus
  promotedAt: Date | null
  promotedBy: string | null
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
}

export interface StreamMember {
  streamId: string
  userId: string
  role: MemberRole
  notifyLevel: NotifyLevel
  lastReadEventId: string | null
  lastReadAt: Date
  addedByUserId: string | null
  joinedAt: Date
  leftAt: Date | null
}

export interface Mention {
  type: "user" | "channel" | "crosspost"
  id: string
  label: string
  slug?: string
}

export interface StreamEvent {
  id: string
  streamId: string
  eventType: EventType
  actorId: string
  contentType: string | null
  contentId: string | null
  payload: Record<string, unknown> | null
  createdAt: Date
  editedAt: Date | null
  deletedAt: Date | null
}

export interface StreamEventWithDetails extends StreamEvent {
  actorEmail: string
  actorName: string
  // For message events
  content?: string
  mentions?: Mention[]
  // For shared events
  originalEventId?: string
  shareContext?: string
  originalEvent?: StreamEventWithDetails
  // Computed
  replyCount?: number
  isEdited?: boolean
}

// Bootstrap types
export interface BootstrapStream {
  id: string
  name: string | null
  slug: string | null
  description: string | null
  topic: string | null
  streamType: StreamType
  visibility: StreamVisibility
  isMember: boolean
  unreadCount: number
  lastReadAt: Date | null
  notifyLevel: NotifyLevel
  parentStreamId: string | null
  pinnedAt: Date | null
}

// Access control result
export interface StreamAccessResult {
  hasAccess: boolean
  isMember: boolean
  canPost: boolean
  reason?: string
}

export interface BootstrapUser {
  id: string
  name: string
  email: string
  role: "admin" | "member" | "guest"
}

export interface BootstrapResult {
  workspace: {
    id: string
    name: string
    slug: string
    planTier: string
  }
  userRole: "admin" | "member" | "guest"
  streams: BootstrapStream[]
  users: BootstrapUser[]
}

// Operation params
export interface CreateStreamParams {
  workspaceId: string
  streamType: StreamType
  creatorId: string
  name?: string
  slug?: string
  description?: string
  visibility?: StreamVisibility
  parentStreamId?: string
  branchedFromEventId?: string
  metadata?: Record<string, unknown>
}

export interface CreateEventParams {
  streamId: string
  actorId: string
  eventType: EventType
  content?: string
  mentions?: Mention[]
  payload?: Record<string, unknown>
  originalEventId?: string // For shared events
  shareContext?: string // For shared events
}

export interface PromoteStreamParams {
  streamId: string
  userId: string
  newType: "channel" | "incident"
  name: string
  slug?: string
  visibility?: StreamVisibility
}

export interface ReplyToEventParams {
  workspaceId: string
  parentStreamId: string
  eventId: string
  actorId: string
  content: string
  mentions?: Mention[]
}

export interface ReplyToEventResult {
  stream: Stream
  event: StreamEventWithDetails
  threadCreated: boolean
}

// ============================================================================
// StreamService
// ============================================================================

export class StreamService {
  constructor(private pool: Pool) {}

  // ==========================================================================
  // Bootstrap
  // ==========================================================================

  async bootstrap(workspaceId: string, userId: string): Promise<BootstrapResult> {
    const client = await this.pool.connect()
    try {
      const [workspaceRes, streamsRes, usersRes] = await Promise.all([
        // 1. Workspace info + user's role
        client.query(
          sql`SELECT
              w.id, w.name, w.slug, w.plan_tier,
              wm.role
            FROM workspaces w
            INNER JOIN workspace_members wm ON w.id = wm.workspace_id
            WHERE w.id = ${workspaceId} AND wm.user_id = ${userId}`,
        ),

        // 2. All streams user is a member of (not public streams they haven't joined)
        client.query(
          sql`SELECT
              s.id, s.name, s.slug, s.description, s.topic,
              s.stream_type, s.visibility, s.parent_stream_id,
              true as is_member,
              sm.last_read_at,
              sm.pinned_at,
              COALESCE(sm.notify_level, 'default') as notify_level,
              COALESCE(
                (SELECT COUNT(*)::int FROM stream_events e
                 WHERE e.stream_id = s.id
                 AND e.created_at > COALESCE(sm.last_read_at, '1970-01-01'::timestamptz)
                 AND e.deleted_at IS NULL
                 AND e.actor_id != ${userId}),
                0
              ) as unread_count
            FROM streams s
            INNER JOIN stream_members sm ON s.id = sm.stream_id
              AND sm.user_id = ${userId}
              AND sm.left_at IS NULL
            WHERE s.workspace_id = ${workspaceId}
              AND s.archived_at IS NULL
              AND s.stream_type IN ('channel', 'dm')
            ORDER BY sm.pinned_at DESC NULLS LAST, s.name`,
        ),

        // 3. All workspace members
        client.query(
          sql`SELECT u.id, u.name, u.email, wm.role
            FROM users u
            INNER JOIN workspace_members wm ON u.id = wm.user_id
            WHERE wm.workspace_id = ${workspaceId}
              AND wm.status = 'active'
              AND u.deleted_at IS NULL
            ORDER BY u.name`,
        ),
      ])

      const workspace = workspaceRes.rows[0]
      if (!workspace) {
        throw new Error("Workspace not found or user is not a member")
      }

      return {
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          planTier: workspace.plan_tier,
        },
        userRole: workspace.role,
        streams: streamsRes.rows.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          description: row.description,
          topic: row.topic,
          streamType: row.stream_type as StreamType,
          visibility: row.visibility as StreamVisibility,
          isMember: row.is_member,
          unreadCount: row.unread_count,
          lastReadAt: row.last_read_at,
          notifyLevel: row.notify_level as NotifyLevel,
          parentStreamId: row.parent_stream_id,
          pinnedAt: row.pinned_at,
        })),
        users: usersRes.rows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
        })),
      }
    } finally {
      client.release()
    }
  }

  // ==========================================================================
  // Stream Operations
  // ==========================================================================

  async createStream(params: CreateStreamParams): Promise<Stream> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      const streamId = generateId("stream")
      const slug = params.slug || (params.name ? await createValidSlug(params.name) : null)

      // Check slug uniqueness if provided
      if (slug) {
        const existingSlug = await client.query(
          sql`SELECT 1 FROM streams WHERE workspace_id = ${params.workspaceId} AND slug = ${slug}`,
        )
        if (existingSlug.rows.length > 0) {
          throw new Error(`Slug "${slug}" already exists in this workspace`)
        }
      }

      // Create the stream
      const result = await client.query<Stream>(
        sql`INSERT INTO streams (
              id, workspace_id, stream_type, name, slug, description,
              visibility, parent_stream_id, branched_from_event_id, metadata
            )
            VALUES (
              ${streamId}, ${params.workspaceId}, ${params.streamType},
              ${params.name || null}, ${slug}, ${params.description || null},
              ${params.visibility || "public"}, ${params.parentStreamId || null},
              ${params.branchedFromEventId || null}, ${JSON.stringify(params.metadata || {})}
            )
            RETURNING *`,
      )

      const stream = result.rows[0]

      // Add creator as owner/member
      await client.query(
        sql`INSERT INTO stream_members (stream_id, user_id, role, added_by_user_id)
            VALUES (${streamId}, ${params.creatorId}, 'owner', ${params.creatorId})`,
      )

      // Emit outbox event
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, 'stream.created', ${JSON.stringify({
              stream_id: streamId,
              workspace_id: params.workspaceId,
              stream_type: params.streamType,
              name: params.name,
              slug,
              visibility: params.visibility || "public",
              creator_id: params.creatorId,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")

      logger.info({ streamId, type: params.streamType }, "Stream created")

      return this.mapStreamRow(stream)
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async getStream(streamId: string): Promise<Stream | null> {
    const result = await this.pool.query(sql`SELECT * FROM streams WHERE id = ${streamId}`)
    return result.rows[0] ? this.mapStreamRow(result.rows[0]) : null
  }

  async getStreamBySlug(workspaceId: string, slug: string): Promise<Stream | null> {
    const result = await this.pool.query(
      sql`SELECT * FROM streams
          WHERE workspace_id = ${workspaceId} AND slug = ${slug}`,
    )
    return result.rows[0] ? this.mapStreamRow(result.rows[0]) : null
  }

  async createThreadFromEvent(
    eventId: string,
    creatorId: string,
  ): Promise<{ stream: Stream; event: StreamEventWithDetails }> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Get the original event and its stream
      const eventResult = await client.query(
        sql`SELECT e.*, s.workspace_id, s.id as parent_stream_id
            FROM stream_events e
            INNER JOIN streams s ON e.stream_id = s.id
            WHERE e.id = ${eventId}`,
      )

      const originalEvent = eventResult.rows[0]
      if (!originalEvent) {
        throw new Error("Event not found")
      }

      // Check if thread already exists - if so, return it instead of creating a new one
      const existingThread = await client.query(sql`SELECT * FROM streams WHERE branched_from_event_id = ${eventId}`)
      if (existingThread.rows.length > 0) {
        await client.query("COMMIT")
        const stream = this.mapStreamRow(existingThread.rows[0])
        // Return the existing stream with a placeholder event (the original thread_started event)
        const threadStartedEvent = await this.pool.query(
          sql`SELECT * FROM stream_events
              WHERE stream_id = ${originalEvent.parent_stream_id}
              AND event_type = 'thread_started'
              AND payload->>'thread_id' = ${existingThread.rows[0].id}
              LIMIT 1`,
        )
        const event = threadStartedEvent.rows[0] ? await this.getEventWithDetails(threadStartedEvent.rows[0].id) : null
        return { stream, event: event || ({} as StreamEventWithDetails) }
      }

      // Create the thread stream
      const streamId = generateId("stream")
      const streamResult = await client.query(
        sql`INSERT INTO streams (
              id, workspace_id, stream_type, parent_stream_id,
              branched_from_event_id, visibility
            )
            VALUES (
              ${streamId}, ${originalEvent.workspace_id}, 'thread',
              ${originalEvent.parent_stream_id}, ${eventId}, 'inherit'
            )
            RETURNING *`,
      )

      // Copy parent stream membership to thread
      await client.query(
        sql`INSERT INTO stream_members (stream_id, user_id, role, notify_level)
            SELECT ${streamId}, user_id, 'member', notify_level
            FROM stream_members
            WHERE stream_id = ${originalEvent.parent_stream_id}
              AND left_at IS NULL`,
      )

      // Create a "thread_started" event in the parent stream
      const threadEventId = generateId("event")
      await client.query(
        sql`INSERT INTO stream_events (id, stream_id, event_type, actor_id, payload)
            VALUES (${threadEventId}, ${originalEvent.parent_stream_id}, 'thread_started',
                    ${creatorId}, ${JSON.stringify({ thread_id: streamId, original_event_id: eventId })})`,
      )

      // Emit outbox event
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, 'stream.created', ${JSON.stringify({
              stream_id: streamId,
              workspace_id: originalEvent.workspace_id,
              stream_type: "thread",
              parent_stream_id: originalEvent.parent_stream_id,
              branched_from_event_id: eventId,
              creator_id: creatorId,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")

      const stream = this.mapStreamRow(streamResult.rows[0])
      const event = await this.getEventWithDetails(threadEventId)

      logger.info({ streamId, parentStreamId: originalEvent.parent_stream_id }, "Thread created")

      return { stream, event: event! }
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get thread for an event if it exists
   */
  async getThreadForEvent(eventId: string): Promise<Stream | null> {
    const result = await this.pool.query(sql`SELECT * FROM streams WHERE branched_from_event_id = ${eventId}`)
    return result.rows[0] ? this.mapStreamRow(result.rows[0]) : null
  }

  /**
   * Reply to an event - creates thread atomically if needed, then posts message
   * Handles race conditions by using SELECT FOR UPDATE
   */
  async replyToEvent(params: ReplyToEventParams): Promise<ReplyToEventResult> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Get the original event with lock to prevent race conditions
      const eventResult = await client.query(
        sql`SELECT e.*, s.workspace_id, s.id as parent_stream_id
            FROM stream_events e
            INNER JOIN streams s ON e.stream_id = s.id
            WHERE e.id = ${params.eventId}
            FOR UPDATE`,
      )

      const originalEvent = eventResult.rows[0]
      if (!originalEvent) {
        throw new Error("Event not found")
      }

      // Check if thread already exists (with lock)
      const existingThread = await client.query(
        sql`SELECT * FROM streams WHERE branched_from_event_id = ${params.eventId} FOR UPDATE`,
      )

      let threadStream: Stream
      let threadCreated = false

      if (existingThread.rows.length > 0) {
        // Thread exists - use it
        threadStream = this.mapStreamRow(existingThread.rows[0])
      } else {
        // Create the thread
        const streamId = generateId("stream")
        const streamResult = await client.query(
          sql`INSERT INTO streams (
                id, workspace_id, stream_type, parent_stream_id,
                branched_from_event_id, visibility
              )
              VALUES (
                ${streamId}, ${originalEvent.workspace_id}, 'thread',
                ${params.parentStreamId}, ${params.eventId}, 'inherit'
              )
              RETURNING *`,
        )

        // Copy parent stream membership to thread
        await client.query(
          sql`INSERT INTO stream_members (stream_id, user_id, role, notify_level)
              SELECT ${streamId}, user_id, 'member', notify_level
              FROM stream_members
              WHERE stream_id = ${params.parentStreamId}
                AND left_at IS NULL`,
        )

        threadStream = this.mapStreamRow(streamResult.rows[0])
        threadCreated = true

        // Emit stream.created event
        const streamOutboxId = generateId("outbox")
        await client.query(
          sql`INSERT INTO outbox (id, event_type, payload)
              VALUES (${streamOutboxId}, 'stream.created', ${JSON.stringify({
                stream_id: streamId,
                workspace_id: originalEvent.workspace_id,
                stream_type: "thread",
                parent_stream_id: params.parentStreamId,
                branched_from_event_id: params.eventId,
                creator_id: params.actorId,
              })})`,
        )
        await client.query(`NOTIFY outbox_event, '${streamOutboxId.replace(/'/g, "''")}'`)

        logger.info({ streamId, parentStreamId: params.parentStreamId }, "Thread created for reply")
      }

      // Now post the message to the thread
      const messageId = generateId("msg")
      await client.query(
        sql`INSERT INTO text_messages (id, content, mentions)
            VALUES (${messageId}, ${params.content}, ${JSON.stringify(params.mentions || [])})`,
      )

      const eventId = generateId("event")
      await client.query(
        sql`INSERT INTO stream_events (id, stream_id, event_type, actor_id, content_type, content_id)
            VALUES (${eventId}, ${threadStream.id}, 'message', ${params.actorId}, 'text_message', ${messageId})`,
      )

      // Emit event.created
      const eventOutboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${eventOutboxId}, 'stream_event.created', ${JSON.stringify({
              event_id: eventId,
              stream_id: threadStream.id,
              workspace_id: params.workspaceId,
              event_type: "message",
              actor_id: params.actorId,
              content: params.content,
              mentions: params.mentions || [],
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${eventOutboxId.replace(/'/g, "''")}'`)

      // Handle mentions - create notifications
      if (params.mentions && params.mentions.length > 0) {
        for (const mention of params.mentions.filter((m) => m.type === "user")) {
          const notifId = generateId("notif")
          await client.query(
            sql`INSERT INTO notifications (id, workspace_id, user_id, notification_type,
                  stream_id, event_id, actor_id, preview)
                VALUES (${notifId}, ${params.workspaceId}, ${mention.id}, 'mention',
                        ${threadStream.id}, ${eventId}, ${params.actorId}, ${params.content.substring(0, 100)})`,
          )

          const notifOutboxId = generateId("outbox")
          await client.query(
            sql`INSERT INTO outbox (id, event_type, payload)
                VALUES (${notifOutboxId}, 'notification.created', ${JSON.stringify({
                  notification_id: notifId,
                  user_id: mention.id,
                  workspace_id: params.workspaceId,
                  stream_id: threadStream.id,
                  event_id: eventId,
                  notification_type: "mention",
                  actor_id: params.actorId,
                })})`,
          )
          await client.query(`NOTIFY outbox_event, '${notifOutboxId.replace(/'/g, "''")}'`)
        }
      }

      // Mark the reply as read for the sender
      await client.query(
        sql`INSERT INTO stream_members (stream_id, user_id, last_read_event_id, last_read_at)
            VALUES (${threadStream.id}, ${params.actorId}, ${eventId}, NOW())
            ON CONFLICT (stream_id, user_id)
            DO UPDATE SET last_read_event_id = ${eventId}, last_read_at = NOW()`,
      )

      await client.query("COMMIT")

      const event = await this.getEventWithDetails(eventId)

      return {
        stream: threadStream,
        event: event!,
        threadCreated,
      }
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async promoteStream(params: PromoteStreamParams): Promise<Stream> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Get current stream
      const currentResult = await client.query(sql`SELECT * FROM streams WHERE id = ${params.streamId}`)
      const current = currentResult.rows[0]
      if (!current) {
        throw new Error("Stream not found")
      }

      if (current.stream_type !== "thread") {
        throw new Error("Only threads can be promoted")
      }

      // Generate slug
      const slug = params.slug || (await createValidSlug(params.name))

      // Check slug uniqueness
      const existingSlug = await client.query(
        sql`SELECT 1 FROM streams WHERE workspace_id = ${current.workspace_id} AND slug = ${slug}`,
      )
      if (existingSlug.rows.length > 0) {
        throw new Error(`Slug "${slug}" already exists in this workspace`)
      }

      // Update the stream
      const result = await client.query(
        sql`UPDATE streams SET
              stream_type = ${params.newType},
              name = ${params.name},
              slug = ${slug},
              visibility = ${params.visibility || current.visibility},
              promoted_at = NOW(),
              promoted_by = ${params.userId},
              updated_at = NOW()
            WHERE id = ${params.streamId}
            RETURNING *`,
      )

      // Create a system event in the parent stream
      if (current.parent_stream_id) {
        const eventId = generateId("event")
        await client.query(
          sql`INSERT INTO stream_events (id, stream_id, event_type, actor_id, payload)
              VALUES (${eventId}, ${current.parent_stream_id}, 'thread_started', ${params.userId},
                      ${JSON.stringify({
                        promoted_to: params.newType,
                        new_name: params.name,
                        new_slug: slug,
                        stream_id: params.streamId,
                      })})`,
        )
      }

      // Emit outbox event
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, 'stream.promoted', ${JSON.stringify({
              stream_id: params.streamId,
              workspace_id: current.workspace_id,
              new_type: params.newType,
              new_name: params.name,
              new_slug: slug,
              promoted_by: params.userId,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")

      logger.info({ streamId: params.streamId, newType: params.newType }, "Stream promoted")

      return this.mapStreamRow(result.rows[0])
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async archiveStream(streamId: string): Promise<void> {
    await this.pool.query(sql`UPDATE streams SET archived_at = NOW(), updated_at = NOW() WHERE id = ${streamId}`)
  }

  // ==========================================================================
  // Event Operations
  // ==========================================================================

  async createEvent(params: CreateEventParams): Promise<StreamEventWithDetails> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      const eventId = generateId("event")
      let contentType: string | null = null
      let contentId: string | null = null

      // Create content based on event type
      if (params.eventType === "message" && params.content) {
        contentType = "text_message"
        contentId = generateId("msg")
        await client.query(
          sql`INSERT INTO text_messages (id, content, mentions)
              VALUES (${contentId}, ${params.content}, ${JSON.stringify(params.mentions || [])})`,
        )
      } else if (params.eventType === "shared" && params.originalEventId) {
        contentType = "shared_ref"
        contentId = generateId("share")
        await client.query(
          sql`INSERT INTO shared_refs (id, original_event_id, context)
              VALUES (${contentId}, ${params.originalEventId}, ${params.shareContext || null})`,
        )
      }

      // Create the event
      await client.query(
        sql`INSERT INTO stream_events (id, stream_id, event_type, actor_id, content_type, content_id, payload)
            VALUES (${eventId}, ${params.streamId}, ${params.eventType}, ${params.actorId},
                    ${contentType}, ${contentId}, ${params.payload ? JSON.stringify(params.payload) : null})`,
      )

      // Get stream info for notifications
      const streamResult = await client.query(
        sql`SELECT workspace_id, stream_type, parent_stream_id, slug FROM streams WHERE id = ${params.streamId}`,
      )
      const stream = streamResult.rows[0]

      if (!stream) {
        throw new Error(`Stream not found: ${params.streamId}`)
      }

      // Handle mentions - create notifications
      if (params.mentions && params.mentions.length > 0) {
        const userMentions = params.mentions.filter((m) => m.type === "user")
        for (const mention of userMentions) {
          if (mention.id === params.actorId) continue // Don't notify self

          const notifId = generateId("notif")
          await client.query(
            sql`INSERT INTO notifications (id, workspace_id, user_id, notification_type,
                                           stream_id, event_id, actor_id, preview)
                VALUES (${notifId}, ${stream.workspace_id}, ${mention.id}, 'mention',
                        ${params.streamId}, ${eventId}, ${params.actorId},
                        ${params.content?.substring(0, 100) || null})
                ON CONFLICT DO NOTHING`,
          )

          // Emit notification event
          const notifOutboxId = generateId("outbox")
          await client.query(
            sql`INSERT INTO outbox (id, event_type, payload)
                VALUES (${notifOutboxId}, 'notification.created', ${JSON.stringify({
                  id: notifId,
                  workspace_id: stream.workspace_id,
                  user_id: mention.id,
                  notification_type: "mention",
                  stream_id: params.streamId,
                  event_id: eventId,
                  actor_id: params.actorId,
                  preview: params.content?.substring(0, 100),
                })})`,
          )
          await client.query(`NOTIFY outbox_event, '${notifOutboxId.replace(/'/g, "''")}'`)
        }

        // Handle crosspost mentions - share to other streams
        const crossposts = params.mentions.filter((m) => m.type === "crosspost")
        for (const crosspost of crossposts) {
          const shareEventId = generateId("event")
          const shareContentId = generateId("share")

          await client.query(
            sql`INSERT INTO shared_refs (id, original_event_id, context)
                VALUES (${shareContentId}, ${eventId}, null)`,
          )

          await client.query(
            sql`INSERT INTO stream_events (id, stream_id, event_type, actor_id, content_type, content_id)
                VALUES (${shareEventId}, ${crosspost.id}, 'shared', ${params.actorId},
                        'shared_ref', ${shareContentId})`,
          )

          // Emit event for the target stream
          const crosspostOutboxId = generateId("outbox")
          await client.query(
            sql`INSERT INTO outbox (id, event_type, payload)
                VALUES (${crosspostOutboxId}, 'stream_event.created', ${JSON.stringify({
                  event_id: shareEventId,
                  stream_id: crosspost.id,
                  workspace_id: stream.workspace_id,
                  event_type: "shared",
                  actor_id: params.actorId,
                  is_crosspost: true,
                  original_stream_id: params.streamId,
                })})`,
          )
          await client.query(`NOTIFY outbox_event, '${crosspostOutboxId.replace(/'/g, "''")}'`)
        }
      }

      // Emit main event
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, 'stream_event.created', ${JSON.stringify({
              event_id: eventId,
              stream_id: params.streamId,
              workspace_id: stream.workspace_id,
              stream_slug: stream.slug,
              event_type: params.eventType,
              actor_id: params.actorId,
              content: params.content,
              mentions: params.mentions,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      // Update read cursor for the author
      await client.query(
        sql`UPDATE stream_members SET last_read_event_id = ${eventId}, last_read_at = NOW()
            WHERE stream_id = ${params.streamId} AND user_id = ${params.actorId}`,
      )

      await client.query("COMMIT")

      logger.info({ eventId, streamId: params.streamId, type: params.eventType }, "Event created")

      return (await this.getEventWithDetails(eventId))!
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async getStreamEvents(streamId: string, limit: number = 50, offset: number = 0): Promise<StreamEventWithDetails[]> {
    const result = await this.pool.query(
      sql`SELECT
            e.id, e.stream_id, e.event_type, e.actor_id,
            e.content_type, e.content_id, e.payload,
            e.created_at, e.edited_at, e.deleted_at,
            u.email as actor_email, u.name as actor_name,
            tm.content, tm.mentions,
            sr.original_event_id, sr.context as share_context,
            (SELECT COUNT(*) FROM stream_events se2
             INNER JOIN streams t ON se2.stream_id = t.id
             WHERE t.branched_from_event_id = e.id
               AND se2.deleted_at IS NULL
               AND se2.event_type = 'message') as reply_count
          FROM stream_events e
          INNER JOIN users u ON e.actor_id = u.id
          LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
          LEFT JOIN shared_refs sr ON e.content_type = 'shared_ref' AND e.content_id = sr.id
          WHERE e.stream_id = ${streamId}
            AND e.deleted_at IS NULL
          ORDER BY e.created_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
    )

    // Reverse for chronological order
    const events = result.rows.reverse()

    // Hydrate shared refs with original events
    const sharedEvents = events.filter((e) => e.content_type === "shared_ref" && e.original_event_id)
    if (sharedEvents.length > 0) {
      const originalIds = sharedEvents.map((e) => e.original_event_id)
      const originals = await this.pool.query(
        sql`SELECT
              e.id, e.stream_id, e.event_type, e.actor_id,
              e.content_type, e.content_id, e.created_at,
              u.email as actor_email, u.name as actor_name,
              tm.content, tm.mentions
            FROM stream_events e
            INNER JOIN users u ON e.actor_id = u.id
            LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
            WHERE e.id = ANY(${originalIds})`,
      )

      const originalMap = new Map(originals.rows.map((o) => [o.id, o]))
      for (const event of sharedEvents) {
        const original = originalMap.get(event.original_event_id)
        if (original) {
          event.original_event = this.mapEventRow(original)
        }
      }
    }

    return events.map((row) => this.mapEventRow(row))
  }

  async getEventWithDetails(eventId: string): Promise<StreamEventWithDetails | null> {
    const result = await this.pool.query(
      sql`SELECT
            e.id, e.stream_id, e.event_type, e.actor_id,
            e.content_type, e.content_id, e.payload,
            e.created_at, e.edited_at, e.deleted_at,
            u.email as actor_email, u.name as actor_name,
            tm.content, tm.mentions,
            sr.original_event_id, sr.context as share_context,
            (SELECT COUNT(*) FROM stream_events se2
             INNER JOIN streams t ON se2.stream_id = t.id
             WHERE t.branched_from_event_id = e.id
               AND se2.deleted_at IS NULL
               AND se2.event_type = 'message') as reply_count
          FROM stream_events e
          INNER JOIN users u ON e.actor_id = u.id
          LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
          LEFT JOIN shared_refs sr ON e.content_type = 'shared_ref' AND e.content_id = sr.id
          WHERE e.id = ${eventId}`,
    )

    if (!result.rows[0]) return null

    const event = result.rows[0]

    // Hydrate shared ref if needed
    if (event.content_type === "shared_ref" && event.original_event_id) {
      const original = await this.getEventWithDetails(event.original_event_id)
      if (original) {
        event.original_event = original
      }
    }

    return this.mapEventRow(event)
  }

  async editEvent(eventId: string, userId: string, newContent: string): Promise<StreamEventWithDetails> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Get the event
      const eventResult = await client.query(
        sql`SELECT e.*, s.workspace_id FROM stream_events e
            INNER JOIN streams s ON e.stream_id = s.id
            WHERE e.id = ${eventId}`,
      )
      const event = eventResult.rows[0]

      if (!event) throw new Error("Event not found")
      if (event.actor_id !== userId) throw new Error("Can only edit your own events")
      if (event.event_type !== "message") throw new Error("Can only edit message events")
      if (!event.content_id) throw new Error("Event has no content to edit")

      // Get old content for revision
      const oldContent = await client.query(sql`SELECT content FROM text_messages WHERE id = ${event.content_id}`)

      // Create revision
      const revisionId = generateId("rev")
      await client.query(
        sql`INSERT INTO message_revisions (id, message_id, content)
            VALUES (${revisionId}, ${event.content_id}, ${oldContent.rows[0]?.content || ""})`,
      )

      // Update content
      await client.query(sql`UPDATE text_messages SET content = ${newContent} WHERE id = ${event.content_id}`)

      // Update event timestamp
      await client.query(sql`UPDATE stream_events SET edited_at = NOW() WHERE id = ${eventId}`)

      // Emit outbox event
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, 'stream_event.edited', ${JSON.stringify({
              event_id: eventId,
              stream_id: event.stream_id,
              workspace_id: event.workspace_id,
              content: newContent,
              edited_at: new Date().toISOString(),
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")

      return (await this.getEventWithDetails(eventId))!
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async deleteEvent(eventId: string, userId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      const eventResult = await client.query(
        sql`SELECT e.*, s.workspace_id FROM stream_events e
            INNER JOIN streams s ON e.stream_id = s.id
            WHERE e.id = ${eventId}`,
      )
      const event = eventResult.rows[0]

      if (!event) throw new Error("Event not found")
      if (event.actor_id !== userId) throw new Error("Can only delete your own events")

      await client.query(sql`UPDATE stream_events SET deleted_at = NOW() WHERE id = ${eventId}`)

      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, 'stream_event.deleted', ${JSON.stringify({
              event_id: eventId,
              stream_id: event.stream_id,
              workspace_id: event.workspace_id,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  // ==========================================================================
  // Membership Operations
  // ==========================================================================

  async joinStream(streamId: string, userId: string): Promise<{ stream: Stream; event: StreamEventWithDetails }> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      await client.query(
        sql`INSERT INTO stream_members (stream_id, user_id, role)
            VALUES (${streamId}, ${userId}, 'member')
            ON CONFLICT (stream_id, user_id) DO UPDATE SET left_at = NULL, updated_at = NOW()`,
      )

      // Create member_joined event
      const eventId = generateId("event")
      await client.query(
        sql`INSERT INTO stream_events (id, stream_id, event_type, actor_id, payload)
            VALUES (${eventId}, ${streamId}, 'member_joined', ${userId},
                    ${JSON.stringify({ user_id: userId })})`,
      )

      // Get stream info
      const streamResult = await client.query(sql`SELECT * FROM streams WHERE id = ${streamId}`)
      const streamRow = streamResult.rows[0]

      // Emit stream_event.created for the member_joined event (so it broadcasts to the room)
      const eventOutboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${eventOutboxId}, 'stream_event.created', ${JSON.stringify({
              event_id: eventId,
              stream_id: streamId,
              workspace_id: streamRow?.workspace_id,
              stream_slug: streamRow?.slug,
              event_type: "member_joined",
              actor_id: userId,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${eventOutboxId.replace(/'/g, "''")}'`)

      // Also emit stream.member_joined for sidebar/workspace-level updates
      const memberOutboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${memberOutboxId}, 'stream.member_added', ${JSON.stringify({
              stream_id: streamId,
              stream_name: streamRow?.name,
              stream_slug: streamRow?.slug,
              workspace_id: streamRow?.workspace_id,
              user_id: userId,
              added_by_user_id: userId,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${memberOutboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")

      const stream = this.mapStreamRow(streamRow)
      const event = await this.getEventWithDetails(eventId)

      return { stream, event: event! }
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async leaveStream(streamId: string, userId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      await client.query(
        sql`UPDATE stream_members SET left_at = NOW(), updated_at = NOW()
            WHERE stream_id = ${streamId} AND user_id = ${userId}`,
      )

      const eventId = generateId("event")
      await client.query(
        sql`INSERT INTO stream_events (id, stream_id, event_type, actor_id, payload)
            VALUES (${eventId}, ${streamId}, 'member_left', ${userId},
                    ${JSON.stringify({ user_id: userId })})`,
      )

      const streamResult = await client.query(sql`SELECT * FROM streams WHERE id = ${streamId}`)
      const streamRow = streamResult.rows[0]

      // Emit stream_event.created for the member_left event (so it broadcasts to the room)
      const eventOutboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${eventOutboxId}, 'stream_event.created', ${JSON.stringify({
              event_id: eventId,
              stream_id: streamId,
              workspace_id: streamRow?.workspace_id,
              stream_slug: streamRow?.slug,
              event_type: "member_left",
              actor_id: userId,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${eventOutboxId.replace(/'/g, "''")}'`)

      // Also emit stream.member_removed for sidebar/workspace-level updates
      const memberOutboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${memberOutboxId}, 'stream.member_removed', ${JSON.stringify({
              stream_id: streamId,
              stream_name: streamRow?.name,
              workspace_id: streamRow?.workspace_id,
              user_id: userId,
              removed_by_user_id: userId,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${memberOutboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async addMember(streamId: string, userId: string, addedByUserId: string, role: MemberRole = "member"): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      await client.query(
        sql`INSERT INTO stream_members (stream_id, user_id, role, added_by_user_id)
            VALUES (${streamId}, ${userId}, ${role}, ${addedByUserId})
            ON CONFLICT (stream_id, user_id) DO UPDATE SET
              left_at = NULL, role = ${role}, updated_at = NOW()`,
      )

      const eventId = generateId("event")
      await client.query(
        sql`INSERT INTO stream_events (id, stream_id, event_type, actor_id, payload)
            VALUES (${eventId}, ${streamId}, 'member_joined', ${addedByUserId},
                    ${JSON.stringify({ user_id: userId, added_by: addedByUserId })})`,
      )

      const stream = await client.query(sql`SELECT workspace_id, name, slug FROM streams WHERE id = ${streamId}`)

      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, 'stream.member_added', ${JSON.stringify({
              stream_id: streamId,
              stream_name: stream.rows[0]?.name,
              stream_slug: stream.rows[0]?.slug,
              workspace_id: stream.rows[0]?.workspace_id,
              user_id: userId,
              added_by_user_id: addedByUserId,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async removeMember(streamId: string, userId: string, removedByUserId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      await client.query(
        sql`UPDATE stream_members SET left_at = NOW(), updated_at = NOW()
            WHERE stream_id = ${streamId} AND user_id = ${userId}`,
      )

      const eventId = generateId("event")
      await client.query(
        sql`INSERT INTO stream_events (id, stream_id, event_type, actor_id, payload)
            VALUES (${eventId}, ${streamId}, 'member_left', ${removedByUserId},
                    ${JSON.stringify({ user_id: userId, removed_by: removedByUserId })})`,
      )

      const stream = await client.query(sql`SELECT workspace_id, name FROM streams WHERE id = ${streamId}`)

      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, 'stream.member_removed', ${JSON.stringify({
              stream_id: streamId,
              stream_name: stream.rows[0]?.name,
              workspace_id: stream.rows[0]?.workspace_id,
              user_id: userId,
              removed_by_user_id: removedByUserId,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async getStreamMembers(streamId: string): Promise<Array<StreamMember & { email: string; name: string }>> {
    const result = await this.pool.query(
      sql`SELECT sm.*, u.email, u.name
          FROM stream_members sm
          INNER JOIN users u ON sm.user_id = u.id
          WHERE sm.stream_id = ${streamId} AND sm.left_at IS NULL
          ORDER BY sm.joined_at`,
    )
    return result.rows.map((row) => ({
      streamId: row.stream_id,
      userId: row.user_id,
      role: row.role as MemberRole,
      notifyLevel: row.notify_level as NotifyLevel,
      lastReadEventId: row.last_read_event_id,
      lastReadAt: row.last_read_at,
      addedByUserId: row.added_by_user_id,
      joinedAt: row.joined_at,
      leftAt: row.left_at,
      email: row.email,
      name: row.name,
    }))
  }

  // ==========================================================================
  // Read State
  // ==========================================================================

  async updateReadCursor(streamId: string, userId: string, eventId: string, workspaceId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      await client.query(
        sql`UPDATE stream_members
            SET last_read_event_id = ${eventId}, last_read_at = NOW(), updated_at = NOW()
            WHERE stream_id = ${streamId} AND user_id = ${userId}`,
      )

      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, 'read_cursor.updated', ${JSON.stringify({
              stream_id: streamId,
              workspace_id: workspaceId,
              user_id: userId,
              event_id: eventId,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async getReadCursor(streamId: string, userId: string): Promise<string | null> {
    const result = await this.pool.query(
      sql`SELECT last_read_event_id FROM stream_members
          WHERE stream_id = ${streamId} AND user_id = ${userId}`,
    )
    return result.rows[0]?.last_read_event_id || null
  }

  // ==========================================================================
  // Notifications
  // ==========================================================================

  async getNotificationCount(workspaceId: string, userId: string): Promise<number> {
    const result = await this.pool.query(
      sql`SELECT COUNT(*)::int as count FROM notifications
          WHERE workspace_id = ${workspaceId}
            AND user_id = ${userId}
            AND read_at IS NULL`,
    )
    return result.rows[0]?.count || 0
  }

  async getNotifications(workspaceId: string, userId: string, limit: number = 50): Promise<any[]> {
    const result = await this.pool.query(
      sql`SELECT
            n.*,
            u.email as actor_email,
            u.name as actor_name,
            s.name as stream_name,
            s.slug as stream_slug,
            s.stream_type
          FROM notifications n
          LEFT JOIN users u ON n.actor_id = u.id
          LEFT JOIN streams s ON n.stream_id = s.id
          WHERE n.workspace_id = ${workspaceId}
            AND n.user_id = ${userId}
          ORDER BY n.created_at DESC
          LIMIT ${limit}`,
    )
    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      notificationType: row.notification_type,
      actorId: row.actor_id,
      actorEmail: row.actor_email,
      actorName: row.actor_name,
      streamId: row.stream_id,
      streamName: row.stream_name,
      streamSlug: row.stream_slug,
      streamType: row.stream_type,
      eventId: row.event_id,
      messageId: row.message_id, // Legacy support
      channelId: row.channel_id, // Legacy support
      isRead: row.read_at !== null,
      readAt: row.read_at,
      createdAt: row.created_at,
    }))
  }

  async markNotificationAsRead(notificationId: string, userId: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE notifications SET read_at = NOW()
          WHERE id = ${notificationId} AND user_id = ${userId}`,
    )
  }

  async markAllNotificationsAsRead(workspaceId: string, userId: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE notifications SET read_at = NOW()
          WHERE workspace_id = ${workspaceId}
            AND user_id = ${userId}
            AND read_at IS NULL`,
    )
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  async getUserEmail(userId: string): Promise<string | null> {
    const result = await this.pool.query(sql`SELECT email FROM users WHERE id = ${userId}`)
    return result.rows[0]?.email || null
  }

  async checkSlugExists(workspaceId: string, slug: string, excludeStreamId?: string): Promise<boolean> {
    const result = await this.pool.query(
      sql`SELECT 1 FROM streams
          WHERE workspace_id = ${workspaceId}
            AND slug = ${slug}
            AND (${excludeStreamId}::text IS NULL OR id != ${excludeStreamId})`,
    )
    return result.rows.length > 0
  }

  /**
   * Check if a user has access to a stream
   * - Members can always access their streams
   * - Non-members cannot access private streams
   * - Non-members cannot access public streams (they need to join first)
   */
  async checkStreamAccess(streamId: string, userId: string): Promise<StreamAccessResult> {
    const result = await this.pool.query(
      sql`SELECT
            s.id, s.visibility, s.stream_type,
            CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member
          FROM streams s
          LEFT JOIN stream_members sm ON s.id = sm.stream_id
            AND sm.user_id = ${userId}
            AND sm.left_at IS NULL
          WHERE s.id = ${streamId}`,
    )

    if (result.rows.length === 0) {
      return { hasAccess: false, isMember: false, canPost: false, reason: "Stream not found" }
    }

    const stream = result.rows[0]
    const isMember = stream.is_member

    // Members always have full access
    if (isMember) {
      return { hasAccess: true, isMember: true, canPost: true }
    }

    // Non-members cannot access any stream - they need to join first
    return {
      hasAccess: false,
      isMember: false,
      canPost: false,
      reason: stream.visibility === "private" ? "This is a private channel" : "You need to join this channel first",
    }
  }

  /**
   * Get all public channels in a workspace that the user can discover
   */
  async getDiscoverableStreams(workspaceId: string, userId: string): Promise<BootstrapStream[]> {
    const result = await this.pool.query(
      sql`SELECT
            s.id, s.name, s.slug, s.description, s.topic,
            s.stream_type, s.visibility, s.parent_stream_id,
            CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
            sm.last_read_at,
            sm.pinned_at,
            COALESCE(sm.notify_level, 'default') as notify_level,
            (SELECT COUNT(*)::int FROM stream_members WHERE stream_id = s.id AND left_at IS NULL) as member_count
          FROM streams s
          LEFT JOIN stream_members sm ON s.id = sm.stream_id
            AND sm.user_id = ${userId}
            AND sm.left_at IS NULL
          WHERE s.workspace_id = ${workspaceId}
            AND s.archived_at IS NULL
            AND s.stream_type = 'channel'
            AND s.visibility = 'public'
          ORDER BY s.name`,
    )

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      topic: row.topic,
      streamType: row.stream_type as StreamType,
      visibility: row.visibility as StreamVisibility,
      isMember: row.is_member,
      unreadCount: 0,
      lastReadAt: row.last_read_at,
      notifyLevel: row.notify_level as NotifyLevel,
      parentStreamId: row.parent_stream_id,
      pinnedAt: row.pinned_at,
      memberCount: row.member_count,
    }))
  }

  /**
   * Pin a stream for a user
   */
  async pinStream(streamId: string, userId: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE stream_members
          SET pinned_at = NOW(), updated_at = NOW()
          WHERE stream_id = ${streamId} AND user_id = ${userId}`,
    )
  }

  /**
   * Unpin a stream for a user
   */
  async unpinStream(streamId: string, userId: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE stream_members
          SET pinned_at = NULL, updated_at = NOW()
          WHERE stream_id = ${streamId} AND user_id = ${userId}`,
    )
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private mapStreamRow(row: any): Stream {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      streamType: row.stream_type as StreamType,
      name: row.name,
      slug: row.slug,
      description: row.description,
      topic: row.topic,
      parentStreamId: row.parent_stream_id,
      branchedFromEventId: row.branched_from_event_id,
      visibility: row.visibility as StreamVisibility,
      status: row.status as StreamStatus,
      promotedAt: row.promoted_at,
      promotedBy: row.promoted_by,
      metadata: row.metadata || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    }
  }

  private mapEventRow(row: any): StreamEventWithDetails {
    return {
      id: row.id,
      streamId: row.stream_id,
      eventType: row.event_type as EventType,
      actorId: row.actor_id,
      contentType: row.content_type,
      contentId: row.content_id,
      payload: row.payload,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deletedAt: row.deleted_at,
      actorEmail: row.actor_email,
      actorName: row.actor_name,
      content: row.content,
      mentions: row.mentions,
      originalEventId: row.original_event_id,
      shareContext: row.share_context,
      originalEvent: row.original_event,
      replyCount: parseInt(row.reply_count || "0", 10),
      isEdited: Boolean(row.edited_at),
    }
  }
}
