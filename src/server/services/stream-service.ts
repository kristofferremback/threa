import { Pool } from "pg"
import { sql, withTransaction } from "../lib/db"
import { logger } from "../lib/logger"
import { generateId } from "../lib/id"
import { createValidSlug } from "../../shared/slug"
import { generateAutoName } from "../lib/ollama"
import { publishOutboxEvent, OutboxEventType } from "../lib/outbox-events"
import {
  queueEnrichmentForThreadParent,
  queueEnrichmentForThreadReply,
  queueEnrichmentForReaction,
  maybeQueueClassification,
} from "../workers"
import {
  StreamRepository,
  StreamMemberRepository,
  StreamEventRepository,
  ReactionRepository,
  NotificationRepository,
  TextMessageRepository,
  MessageRevisionRepository,
  SharedRefRepository,
} from "../repositories"

// ============================================================================
// Types
// ============================================================================

export type StreamType = "channel" | "thread" | "dm" | "incident" | "thinking_space"
export type StreamVisibility = "public" | "private" | "inherit"
export type StreamStatus = "active" | "archived" | "resolved"
export type EventType =
  | "message"
  | "shared"
  | "member_joined"
  | "member_left"
  | "thread_started"
  | "poll"
  | "file"
  | "agent_thinking"
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
  personaId: string | null // For thinking_space: the AI persona that responds automatically
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
  actorId: string | null // null when agentId is set
  agentId: string | null // AI agent/persona ID (mutually exclusive with actorId)
  contentType: string | null
  contentId: string | null
  payload: Record<string, unknown> | null
  createdAt: Date
  editedAt: Date | null
  deletedAt: Date | null
}

export interface StreamEventWithDetails extends StreamEvent {
  actorEmail: string | null
  actorName: string | null
  agentName: string | null // AI agent name when agentId is set
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
  inheritedFrom?: string // Channel ID if access is inherited via parent membership
}

export interface BootstrapUser {
  id: string
  name: string
  email: string
  title: string | null
  avatarUrl: string | null
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
  userProfile: {
    displayName: string | null
    title: string | null
    avatarUrl: string | null
    profileManagedBySso: boolean
  } | null
  needsProfileSetup: boolean
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
  personaId?: string // For thinking_space: the AI persona that responds automatically
}

export interface CreateEventParams {
  streamId: string
  actorId?: string // User who created the event (required unless agentId is set)
  agentId?: string // AI agent/persona who created the event (alternative to actorId)
  eventType: EventType
  content?: string
  mentions?: Mention[]
  payload?: Record<string, unknown>
  originalEventId?: string // For shared events
  shareContext?: string // For shared events
  clientMessageId?: string // Client-generated ID for idempotency
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
  clientMessageId?: string
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
      const [workspaceRes, streamsRes, usersRes, userProfileRes] = await Promise.all([
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
              AND s.stream_type IN ('channel', 'dm', 'thinking_space')
            ORDER BY sm.pinned_at DESC NULLS LAST, s.name`,
        ),

        // 3. All workspace members (with workspace-scoped profile)
        client.query(
          sql`SELECT
              u.id, u.email,
              COALESCE(wp.display_name, u.name) as name,
              wp.title,
              wp.avatar_url,
              wm.role
            FROM users u
            INNER JOIN workspace_members wm ON u.id = wm.user_id
            LEFT JOIN workspace_profiles wp ON wp.workspace_id = wm.workspace_id AND wp.user_id = wm.user_id
            WHERE wm.workspace_id = ${workspaceId}
              AND wm.status = 'active'
              AND u.deleted_at IS NULL
            ORDER BY COALESCE(wp.display_name, u.name)`,
        ),

        // 4. Current user's profile for this workspace
        client.query(
          sql`SELECT
              wp.display_name, wp.title, wp.avatar_url,
              COALESCE(wp.profile_managed_by_sso, false) as profile_managed_by_sso
            FROM workspace_members wm
            LEFT JOIN workspace_profiles wp ON wp.workspace_id = wm.workspace_id AND wp.user_id = wm.user_id
            WHERE wm.workspace_id = ${workspaceId}
              AND wm.user_id = ${userId}`,
        ),
      ])

      const workspace = workspaceRes.rows[0]
      if (!workspace) {
        throw new Error("Workspace not found or user is not a member")
      }

      const userProfile = userProfileRes?.rows[0]
      const needsProfileSetup =
        userProfile &&
        !userProfile.profile_managed_by_sso &&
        (!userProfile.display_name || userProfile.display_name.trim() === "")

      // Build users list (AI personas are handled separately via the personas endpoint)
      const users = usersRes.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        title: row.title,
        avatarUrl: row.avatar_url,
        role: row.role,
      }))

      return {
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          planTier: workspace.plan_tier,
        },
        userRole: workspace.role,
        userProfile: userProfile
          ? {
              displayName: userProfile.display_name,
              title: userProfile.title,
              avatarUrl: userProfile.avatar_url,
              profileManagedBySso: userProfile.profile_managed_by_sso,
            }
          : null,
        needsProfileSetup: needsProfileSetup || false,
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
        users,
      }
    } finally {
      client.release()
    }
  }

  // ==========================================================================
  // Stream Operations
  // ==========================================================================

  async createStream(params: CreateStreamParams): Promise<Stream> {
    const streamId = generateId("stream")
    // createValidSlug returns {slug, valid, error} - extract just the slug
    const slug = params.slug || (params.name ? createValidSlug(params.name).slug : null)

    const stream = await withTransaction(this.pool, async (client) => {
      // Check slug uniqueness if provided
      if (slug) {
        const slugExists = await StreamRepository.slugExists(client, params.workspaceId, slug)
        if (slugExists) {
          throw new Error(`Slug "${slug}" already exists in this workspace`)
        }
      }

      // Create the stream
      const streamRow = await StreamRepository.insertStream(client, {
        id: streamId,
        workspaceId: params.workspaceId,
        streamType: params.streamType,
        name: params.name ?? null,
        slug,
        description: params.description ?? null,
        visibility: params.visibility ?? "public",
        parentStreamId: params.parentStreamId ?? null,
        branchedFromEventId: params.branchedFromEventId ?? null,
        metadata: params.metadata ?? {},
        personaId: params.personaId ?? null,
      })

      // Add creator as owner/member
      await StreamMemberRepository.insertMember(client, {
        streamId,
        userId: params.creatorId,
        role: "owner",
        addedByUserId: params.creatorId,
      })

      // For top-level streams (channels), create a "stream_created" event
      if (!params.parentStreamId) {
        const createdEventId = generateId("event")
        await StreamEventRepository.insertEvent(client, {
          id: createdEventId,
          streamId,
          eventType: "stream_created",
          actorId: params.creatorId,
          payload: { name: params.name, description: params.description },
        })

        // Mark as read for the creator (they created it, so they've seen it)
        await StreamMemberRepository.updateReadCursor(client, streamId, params.creatorId, createdEventId)

        // Emit event for real-time updates
        await publishOutboxEvent(client, OutboxEventType.STREAM_EVENT_CREATED, {
          event_id: createdEventId,
          stream_id: streamId,
          workspace_id: params.workspaceId,
          event_type: "stream_created",
          actor_id: params.creatorId,
        })
      }

      // Emit outbox event for stream creation
      await publishOutboxEvent(client, OutboxEventType.STREAM_CREATED, {
        stream_id: streamId,
        workspace_id: params.workspaceId,
        stream_type: params.streamType,
        name: params.name,
        slug,
        visibility: params.visibility || "public",
        creator_id: params.creatorId,
      })

      return this.mapStreamRow(streamRow)
    })

    logger.info({ streamId, type: params.streamType }, "Stream created")

    return stream
  }

  async getStream(streamId: string): Promise<Stream | null> {
    const client = await this.pool.connect()
    try {
      const row = await StreamRepository.findStreamById(client, streamId)
      return row ? this.mapStreamRow(row) : null
    } finally {
      client.release()
    }
  }

  /**
   * Find an existing DM with the exact same participants.
   * Returns null if no matching DM exists.
   */
  async findExistingDM(workspaceId: string, participantIds: string[]): Promise<Stream | null> {
    if (participantIds.length < 2) {
      return null
    }

    const client = await this.pool.connect()
    try {
      const row = await StreamRepository.findExistingDM(client, workspaceId, participantIds)
      return row ? this.mapStreamRow(row) : null
    } finally {
      client.release()
    }
  }

  /**
   * Create a DM or return existing one with same participants.
   * Generates name from participant names.
   */
  async createDM(
    workspaceId: string,
    creatorId: string,
    participantIds: string[],
  ): Promise<{ stream: Stream; created: boolean }> {
    // Ensure creator is in participants
    const allParticipants = [...new Set([creatorId, ...participantIds])]

    if (allParticipants.length < 2) {
      throw new Error("DM requires at least 2 participants")
    }

    // Check for existing DM
    const existing = await this.findExistingDM(workspaceId, allParticipants)
    if (existing) {
      return { stream: existing, created: false }
    }

    // Get participant names for DM name
    const usersResult = await this.pool.query(sql`SELECT id, name, email FROM users WHERE id = ANY(${allParticipants})`)
    const users = usersResult.rows

    // Generate name from participants (excluding creator for display)
    const otherParticipants = users.filter((u) => u.id !== creatorId)
    const dmName = otherParticipants.map((u) => u.name || u.email.split("@")[0]).join(", ")

    const streamId = generateId("stream")

    const stream = await withTransaction(this.pool, async (client) => {
      // Create DM stream (no slug for DMs)
      const streamRow = await StreamRepository.insertStream(client, {
        id: streamId,
        workspaceId,
        streamType: "dm",
        name: dmName,
        slug: null,
        description: null,
        visibility: "private",
        parentStreamId: null,
        branchedFromEventId: null,
        metadata: { participant_ids: allParticipants.sort() },
        personaId: null,
      })

      // Add all participants as members
      for (const participantId of allParticipants) {
        const role = participantId === creatorId ? "owner" : "member"
        await StreamMemberRepository.insertMember(client, {
          streamId,
          userId: participantId,
          role,
          addedByUserId: creatorId,
        })
      }

      // Emit outbox event for DM creation
      await publishOutboxEvent(client, OutboxEventType.STREAM_CREATED, {
        stream_id: streamId,
        workspace_id: workspaceId,
        stream_type: "dm",
        name: dmName,
        visibility: "private",
        creator_id: creatorId,
        participant_ids: allParticipants,
      })

      return this.mapStreamRow(streamRow)
    })

    logger.info({ streamId, participantCount: allParticipants.length }, "DM created")

    return { stream, created: true }
  }

  async getStreamBySlug(workspaceId: string, slug: string): Promise<Stream | null> {
    const client = await this.pool.connect()
    try {
      const row = await StreamRepository.findStreamBySlug(client, workspaceId, slug)
      return row ? this.mapStreamRow(row) : null
    } finally {
      client.release()
    }
  }

  /**
   * Get the ancestor chain for a thread - all parent events up to the root channel.
   * Returns events in order from closest ancestor to root.
   */
  async getAncestorChain(
    streamId: string,
  ): Promise<{ ancestors: StreamEventWithDetails[]; rootStream: Stream | null }> {
    const ancestors: StreamEventWithDetails[] = []
    let currentStreamId = streamId
    let rootStream: Stream | null = null

    // Walk up the tree, max 10 levels to prevent infinite loops
    for (let i = 0; i < 10; i++) {
      const stream = await this.getStream(currentStreamId)
      if (!stream) break

      // If this stream has no parent, it's the root channel
      if (!stream.parentStreamId || !stream.branchedFromEventId) {
        rootStream = stream
        break
      }

      // Get the event this thread branched from
      const event = await this.getEventWithDetails(stream.branchedFromEventId)
      if (event) {
        ancestors.push(event)
      }

      // Move up to the parent stream
      currentStreamId = stream.parentStreamId
    }

    return { ancestors, rootStream }
  }

  async createThreadFromEvent(
    eventId: string,
    creatorId: string,
  ): Promise<{ stream: Stream; event: StreamEventWithDetails }> {
    type TransactionResult =
      | { type: "existing"; stream: Stream; parentStreamId: string; existingThreadId: string }
      | {
          type: "created"
          stream: Stream
          threadEventId: string
          threadName: string | null
          parentStreamId: string
          workspaceId: string
          contentType: string | null
          contentId: string | null
        }

    const result = await withTransaction(this.pool, async (client): Promise<TransactionResult> => {
      // Get the original event and its stream (including message content for auto-naming)
      const originalEvent = await StreamEventRepository.findEventWithStreamAndContent(client, eventId)
      if (!originalEvent) {
        throw new Error("Event not found")
      }

      // Check if thread already exists - if so, return it instead of creating a new one
      const existingThread = await StreamRepository.findStreamByBranchedFromEventId(client, eventId)
      if (existingThread) {
        return {
          type: "existing",
          stream: this.mapStreamRow(existingThread),
          parentStreamId: originalEvent.stream_id,
          existingThreadId: existingThread.id,
        }
      }

      // Create the thread stream
      const streamId = generateId("stream")
      const streamRow = await StreamRepository.insertStream(client, {
        id: streamId,
        workspaceId: originalEvent.workspace_id,
        streamType: "thread",
        name: null,
        slug: null,
        description: null,
        visibility: "inherit",
        parentStreamId: originalEvent.stream_id,
        branchedFromEventId: eventId,
        metadata: {},
        personaId: null,
      })

      // Note: We do NOT copy parent membership to threads.
      // Access is determined by graph traversal - if you're a member of an ancestor
      // channel/thinking_space, you can access all descendant threads.
      // Direct thread membership is only added when a user explicitly "watches"
      // the thread or posts a message in it.

      // Add the thread creator as a member (so they get notifications)
      await StreamMemberRepository.upsertMember(client, {
        streamId,
        userId: creatorId,
        role: "owner",
        notifyLevel: "all",
      })

      // Auto-name thread based on original message content
      let threadName: string | null = null
      if (originalEvent.message_content) {
        try {
          const nameResult = await generateAutoName(originalEvent.message_content)
          if (nameResult.success && nameResult.name) {
            await StreamRepository.updateStreamName(client, streamId, nameResult.name)
            threadName = nameResult.name
            logger.debug({ streamId, name: nameResult.name }, "Thread auto-named")
          }
        } catch (err) {
          logger.warn({ err, streamId }, "Failed to auto-name thread")
        }
      }

      // Create a "thread_started" event in the parent stream
      const threadEventId = generateId("event")
      await StreamEventRepository.insertEvent(client, {
        id: threadEventId,
        streamId: originalEvent.stream_id,
        eventType: "thread_started",
        actorId: creatorId,
        payload: { thread_id: streamId, original_event_id: eventId },
      })

      // Emit outbox event (include name so frontend receives it)
      await publishOutboxEvent(client, OutboxEventType.STREAM_CREATED, {
        stream_id: streamId,
        workspace_id: originalEvent.workspace_id,
        stream_type: "thread",
        name: threadName,
        parent_stream_id: originalEvent.stream_id,
        branched_from_event_id: eventId,
        creator_id: creatorId,
      })

      const stream = this.mapStreamRow(streamRow)
      stream.name = threadName

      return {
        type: "created",
        stream,
        threadEventId,
        threadName,
        parentStreamId: originalEvent.stream_id,
        workspaceId: originalEvent.workspace_id,
        contentType: originalEvent.content_type,
        contentId: originalEvent.content_id,
      }
    })

    // Handle post-transaction work based on result type
    if (result.type === "existing") {
      // Return the existing stream with a placeholder event (the original thread_started event)
      const threadStartedEvent = await this.pool.query(
        sql`SELECT id FROM stream_events
            WHERE stream_id = ${result.parentStreamId}
            AND event_type = 'thread_started'
            AND payload->>'thread_id' = ${result.existingThreadId}
            LIMIT 1`,
      )
      const event = threadStartedEvent.rows[0] ? await this.getEventWithDetails(threadStartedEvent.rows[0].id) : null
      return { stream: result.stream, event: event || ({} as StreamEventWithDetails) }
    }

    // Thread was created
    const event = await this.getEventWithDetails(result.threadEventId)

    logger.info({ streamId: result.stream.id, parentStreamId: result.parentStreamId }, "Thread created")

    // Queue enrichment for the parent message (thread creation is a signal of value)
    if (result.contentType === "text_message" && result.contentId) {
      queueEnrichmentForThreadParent({
        workspaceId: result.workspaceId,
        parentEventId: eventId,
        parentTextMessageId: result.contentId,
      }).catch((err) => {
        logger.warn({ err, eventId }, "Failed to queue enrichment for thread parent")
      })
    }

    return { stream: result.stream, event: event! }
  }

  /**
   * Get thread for an event if it exists
   */
  async getThreadForEvent(eventId: string): Promise<Stream | null> {
    const client = await this.pool.connect()
    try {
      const row = await StreamRepository.findStreamByBranchedFromEventId(client, eventId)
      return row ? this.mapStreamRow(row) : null
    } finally {
      client.release()
    }
  }

  /**
   * Reply to an event - creates thread atomically if needed, then posts message
   * Handles race conditions by using SELECT FOR UPDATE
   */
  async replyToEvent(params: ReplyToEventParams): Promise<ReplyToEventResult> {
    type TransactionResult =
      | { type: "idempotent"; stream: Stream; event: StreamEventWithDetails }
      | { type: "created"; stream: Stream; eventId: string; messageId: string; threadCreated: boolean }

    const result = await withTransaction(this.pool, async (client): Promise<TransactionResult> => {
      // Get the original event with content and lock to prevent race conditions
      const originalEvent = await StreamEventRepository.findEventWithStreamAndContentForUpdate(client, params.eventId)
      if (!originalEvent) {
        throw new Error("Event not found")
      }

      // Check if thread already exists (with lock)
      const existingThreadRow = await StreamRepository.findStreamByBranchedFromEventIdForUpdate(
        client,
        params.eventId,
      )

      let threadStream: Stream
      let threadCreated = false

      if (existingThreadRow) {
        // Thread exists - use it
        threadStream = this.mapStreamRow(existingThreadRow)
      } else {
        // Create the thread
        const streamId = generateId("stream")
        const streamRow = await StreamRepository.insertStream(client, {
          id: streamId,
          workspaceId: originalEvent.workspace_id,
          streamType: "thread",
          name: null,
          slug: null,
          description: null,
          visibility: "inherit",
          parentStreamId: params.parentStreamId,
          branchedFromEventId: params.eventId,
          metadata: {},
          personaId: null,
        })

        // Copy parent stream membership to thread
        await StreamMemberRepository.copyParentMembership(client, streamId, params.parentStreamId)

        threadStream = this.mapStreamRow(streamRow)
        threadCreated = true

        // Auto-name thread based on original message content (async, non-blocking)
        if (originalEvent.message_content) {
          try {
            const nameResult = await generateAutoName(originalEvent.message_content)
            if (nameResult.success && nameResult.name) {
              await StreamRepository.updateStreamName(client, streamId, nameResult.name)
              threadStream.name = nameResult.name
              logger.debug({ streamId, name: nameResult.name }, "Thread auto-named")
            }
          } catch (err) {
            // Don't fail thread creation if auto-naming fails
            logger.warn({ err, streamId }, "Failed to auto-name thread")
          }
        }

        // Emit stream.created event (include name so frontend receives it)
        await publishOutboxEvent(client, OutboxEventType.STREAM_CREATED, {
          stream_id: streamId,
          workspace_id: originalEvent.workspace_id,
          stream_type: "thread",
          name: threadStream.name,
          parent_stream_id: params.parentStreamId,
          branched_from_event_id: params.eventId,
          creator_id: params.actorId,
        })

        logger.info({ streamId, parentStreamId: params.parentStreamId }, "Thread created for reply")
      }

      // Idempotency check: if clientMessageId is provided, check if message already exists
      if (params.clientMessageId) {
        const existingRow = await StreamEventRepository.findEventByClientMessageId(
          client,
          threadStream.id,
          params.clientMessageId,
        )
        if (existingRow) {
          // Message already exists, return existing event
          return {
            type: "idempotent",
            stream: threadStream,
            event: this.mapEventRow(existingRow),
          }
        }
      }

      // Now post the message to the thread
      const messageId = generateId("msg")
      await TextMessageRepository.insertTextMessage(client, {
        id: messageId,
        content: params.content,
        mentions: params.mentions || [],
      })

      const eventId = generateId("event")
      await StreamEventRepository.insertEvent(client, {
        id: eventId,
        streamId: threadStream.id,
        eventType: "message",
        actorId: params.actorId,
        contentType: "text_message",
        contentId: messageId,
        clientMessageId: params.clientMessageId || null,
      })

      // Emit event.created
      await publishOutboxEvent(client, OutboxEventType.STREAM_EVENT_CREATED, {
        event_id: eventId,
        stream_id: threadStream.id,
        workspace_id: params.workspaceId,
        stream_type: "thread",
        event_type: "message",
        actor_id: params.actorId,
        content: params.content,
        mentions: params.mentions || [],
        client_message_id: params.clientMessageId,
      })

      // Handle mentions - create notifications
      if (params.mentions && params.mentions.length > 0) {
        // Get actor info for notification
        const actorResult = await client.query(sql`SELECT email, name FROM users WHERE id = ${params.actorId}`)
        const actor = actorResult.rows[0]

        // Get parent stream info for notification
        const parentStreamRow = await StreamRepository.findStreamById(client, params.parentStreamId)

        for (const mention of params.mentions.filter((m) => m.type === "user")) {
          if (mention.id === params.actorId) continue // Don't notify self
          if (mention.id?.startsWith("ariadne_")) continue // Ariadne is handled via job queue, not notifications

          const notifId = generateId("notif")
          await NotificationRepository.insertNotification(client, {
            id: notifId,
            workspaceId: params.workspaceId,
            userId: mention.id,
            notificationType: "mention",
            streamId: threadStream.id,
            eventId,
            actorId: params.actorId,
            preview: params.content.substring(0, 100),
          })

          await publishOutboxEvent(client, OutboxEventType.NOTIFICATION_CREATED, {
            id: notifId,
            user_id: mention.id,
            workspace_id: params.workspaceId,
            stream_id: threadStream.id,
            stream_name: parentStreamRow?.name || threadStream.name,
            stream_slug: parentStreamRow?.slug || threadStream.slug,
            event_id: eventId,
            notification_type: "mention",
            actor_id: params.actorId,
            actor_email: actor?.email,
            actor_name: actor?.name,
            preview: params.content.substring(0, 100),
          })
        }
      }

      // Mark the reply as read for the sender
      await StreamMemberRepository.upsertMemberWithReadCursor(client, {
        streamId: threadStream.id,
        userId: params.actorId,
        readEventId: eventId,
      })

      // Emit read cursor update so other devices see the message as read
      await publishOutboxEvent(client, OutboxEventType.READ_CURSOR_UPDATED, {
        stream_id: threadStream.id,
        user_id: params.actorId,
        event_id: eventId,
        workspace_id: params.workspaceId,
      })

      return {
        type: "created",
        stream: threadStream,
        eventId,
        messageId,
        threadCreated,
      }
    })

    // Handle idempotent case - message already existed
    if (result.type === "idempotent") {
      return {
        stream: result.stream,
        event: result.event,
        threadCreated: false,
      }
    }

    // Get full event details after transaction
    const event = await this.getEventWithDetails(result.eventId)

    // Queue classification for the reply message
    maybeQueueClassification({
      workspaceId: params.workspaceId,
      streamId: result.stream.id,
      eventId: result.eventId,
      textMessageId: result.messageId,
      content: params.content,
      contentType: "message",
    }).catch((err) => {
      logger.warn({ err, eventId: result.eventId }, "Failed to queue classification for reply")
    })

    return {
      stream: result.stream,
      event: event!,
      threadCreated: result.threadCreated,
    }
  }

  async promoteStream(params: PromoteStreamParams): Promise<Stream> {
    const streamRow = await withTransaction(this.pool, async (client) => {
      const current = await StreamRepository.findStreamById(client, params.streamId)
      if (!current) {
        throw new Error("Stream not found")
      }

      if (current.stream_type !== "thread") {
        throw new Error("Only threads can be promoted")
      }

      // Generate slug
      const slug = params.slug || createValidSlug(params.name).slug

      // Check slug uniqueness
      const slugExists = await StreamRepository.slugExists(client, current.workspace_id, slug)
      if (slugExists) {
        throw new Error(`Slug "${slug}" already exists in this workspace`)
      }

      // Update the stream
      const result = await StreamRepository.updateStreamType(client, params.streamId, {
        streamType: params.newType,
        name: params.name,
        slug,
        visibility: params.visibility || current.visibility,
        promotedBy: params.userId,
      })

      // Create a system event in the parent stream
      if (current.parent_stream_id) {
        const eventId = generateId("event")
        await StreamEventRepository.insertEvent(client, {
          id: eventId,
          streamId: current.parent_stream_id,
          eventType: "thread_started",
          actorId: params.userId,
          payload: {
            promoted_to: params.newType,
            new_name: params.name,
            new_slug: slug,
            stream_id: params.streamId,
          },
        })
      }

      // Emit outbox event
      await publishOutboxEvent(client, OutboxEventType.STREAM_PROMOTED, {
        stream_id: params.streamId,
        workspace_id: current.workspace_id,
        new_type: params.newType,
        new_name: params.name,
        new_slug: slug,
        promoted_by: params.userId,
      })

      return result
    })

    logger.info({ streamId: params.streamId, newType: params.newType }, "Stream promoted")

    return this.mapStreamRow(streamRow)
  }

  async archiveStream(streamId: string, archivedByUserId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const streamRow = await StreamRepository.findStreamById(client, streamId)
      if (!streamRow) {
        throw new Error("Stream not found")
      }

      await StreamRepository.archiveStream(client, streamId)

      await publishOutboxEvent(client, OutboxEventType.STREAM_ARCHIVED, {
        stream_id: streamId,
        workspace_id: streamRow.workspace_id,
        archived: true,
        archived_by: archivedByUserId,
      })
    })
  }

  async unarchiveStream(streamId: string, unarchivedByUserId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const streamRow = await StreamRepository.findStreamById(client, streamId)
      if (!streamRow) {
        throw new Error("Stream not found")
      }

      await StreamRepository.unarchiveStream(client, streamId)

      await publishOutboxEvent(client, OutboxEventType.STREAM_ARCHIVED, {
        stream_id: streamId,
        workspace_id: streamRow.workspace_id,
        archived: false,
        archived_by: unarchivedByUserId,
      })
    })
  }

  /**
   * Update stream metadata (name, description, topic)
   */
  async updateStream(
    streamId: string,
    updates: { name?: string; description?: string; topic?: string },
    updatedByUserId: string,
  ): Promise<Stream> {
    const streamRow = await withTransaction(this.pool, async (client) => {
      const currentStream = await StreamRepository.findStreamById(client, streamId)
      if (!currentStream) {
        throw new Error("Stream not found")
      }

      const updatedRow = await StreamRepository.updateStreamMetadata(client, streamId, {
        name: updates.name,
        description: updates.description,
        topic: updates.topic,
      })

      await publishOutboxEvent(client, OutboxEventType.STREAM_UPDATED, {
        stream_id: streamId,
        workspace_id: currentStream.workspace_id,
        name: updates.name !== undefined ? updates.name : currentStream.name,
        slug: currentStream.slug,
        description: updates.description !== undefined ? updates.description : currentStream.description,
        topic: updates.topic !== undefined ? updates.topic : currentStream.topic,
        updated_by: updatedByUserId,
      })

      return updatedRow
    })

    return this.mapStreamRow(streamRow)
  }

  // ==========================================================================
  // Event Operations
  // ==========================================================================

  async createEvent(params: CreateEventParams): Promise<StreamEventWithDetails> {
    // Validate that either actorId or agentId is provided
    if (!params.actorId && !params.agentId) {
      throw new Error("Either actorId or agentId must be provided")
    }

    // Discriminated union for transaction result
    type TransactionResult =
      | { type: "idempotent"; event: StreamEventWithDetails }
      | {
          type: "created"
          eventId: string
          contentId: string | null
          stream: { workspace_id: string; stream_type: string; name: string | null; slug: string | null }
        }

    try {
      const result = await withTransaction(this.pool, async (client): Promise<TransactionResult> => {
        // Idempotency check: if clientMessageId is provided, check if event already exists
        if (params.clientMessageId) {
          const existingRow = await StreamEventRepository.findEventByClientMessageId(
            client,
            params.streamId,
            params.clientMessageId,
          )

          if (existingRow) {
            return {
              type: "idempotent",
              event: this.mapEventRow(existingRow),
            }
          }
        }

        const eventId = generateId("event")
        let contentType: string | null = null
        let contentId: string | null = null

        // Create content based on event type
        if (params.eventType === "message" && params.content) {
          contentType = "text_message"
          contentId = generateId("msg")
          await TextMessageRepository.insertTextMessage(client, {
            id: contentId,
            content: params.content,
            mentions: params.mentions || [],
          })
        } else if (params.eventType === "shared" && params.originalEventId) {
          contentType = "shared_ref"
          contentId = generateId("share")
          await SharedRefRepository.insertSharedRef(client, {
            id: contentId,
            originalEventId: params.originalEventId,
            context: params.shareContext || null,
          })
        }

        // Create the event (with either actor_id or agent_id)
        await StreamEventRepository.insertEvent(client, {
          id: eventId,
          streamId: params.streamId,
          eventType: params.eventType,
          actorId: params.actorId || null,
          agentId: params.agentId || null,
          contentType,
          contentId,
          payload: params.payload || null,
          clientMessageId: params.clientMessageId || null,
        })

        // Get stream info for notifications
        const streamRow = await StreamRepository.findStreamById(client, params.streamId)
        if (!streamRow) {
          throw new Error(`Stream not found: ${params.streamId}`)
        }

        const stream = {
          workspace_id: streamRow.workspace_id,
          stream_type: streamRow.stream_type,
          name: streamRow.name,
          slug: streamRow.slug,
        }

        // Auto-name thinking spaces on first message (if name is empty or placeholder)
        const isPlaceholderName = !stream.name || stream.name === "New thinking space"
        if (stream.stream_type === "thinking_space" && isPlaceholderName && params.content) {
          try {
            const nameResult = await generateAutoName(params.content)
            if (nameResult.success && nameResult.name) {
              await StreamRepository.updateStreamName(client, params.streamId, nameResult.name)
              stream.name = nameResult.name
              logger.debug({ streamId: params.streamId, name: nameResult.name }, "Thinking space auto-named")

              // Emit stream.updated event so frontend can update tab titles
              await publishOutboxEvent(client, OutboxEventType.STREAM_UPDATED, {
                stream_id: params.streamId,
                workspace_id: stream.workspace_id,
                name: nameResult.name,
                updated_by: params.actorId || "system",
              })
            }
          } catch (err) {
            // Don't fail event creation if auto-naming fails
            logger.warn({ err, streamId: params.streamId }, "Failed to auto-name thinking space")
          }
        }

        // Handle mentions - create notifications (only for user-created events)
        if (params.actorId && params.mentions && params.mentions.length > 0) {
          const userMentions = params.mentions.filter((m) => m.type === "user")
          for (const mention of userMentions) {
            if (mention.id === params.actorId) continue // Don't notify self
            if (mention.id?.startsWith("ariadne_")) continue // Ariadne is handled via job queue, not notifications

            const notifId = generateId("notif")
            await NotificationRepository.insertNotification(client, {
              id: notifId,
              workspaceId: stream.workspace_id,
              userId: mention.id,
              notificationType: "mention",
              streamId: params.streamId,
              eventId,
              actorId: params.actorId,
              preview: params.content?.substring(0, 100) || null,
            })

            // Get actor info for notification
            const actorResult = await client.query(sql`SELECT email, name FROM users WHERE id = ${params.actorId}`)
            const actor = actorResult.rows[0]

            // Emit notification event
            await publishOutboxEvent(client, OutboxEventType.NOTIFICATION_CREATED, {
              id: notifId,
              workspace_id: stream.workspace_id,
              user_id: mention.id,
              notification_type: "mention",
              stream_id: params.streamId,
              stream_name: stream.name,
              stream_slug: stream.slug,
              event_id: eventId,
              actor_id: params.actorId,
              actor_email: actor?.email,
              actor_name: actor?.name,
              preview: params.content?.substring(0, 100),
            })
          }

          // Handle crosspost mentions - share to other streams
          const crossposts = params.mentions.filter((m) => m.type === "crosspost")
          for (const crosspost of crossposts) {
            const shareEventId = generateId("event")
            const shareContentId = generateId("share")

            await SharedRefRepository.insertSharedRef(client, {
              id: shareContentId,
              originalEventId: eventId,
              context: null,
            })

            await StreamEventRepository.insertEvent(client, {
              id: shareEventId,
              streamId: crosspost.id,
              eventType: "shared",
              actorId: params.actorId,
              contentType: "shared_ref",
              contentId: shareContentId,
            })

            // Emit event for the target stream
            await publishOutboxEvent(client, OutboxEventType.STREAM_EVENT_CREATED, {
              event_id: shareEventId,
              stream_id: crosspost.id,
              workspace_id: stream.workspace_id,
              event_type: "shared",
              actor_id: params.actorId,
              is_crosspost: true,
              original_stream_id: params.streamId,
            })
          }
        }

        // Emit main event
        await publishOutboxEvent(client, OutboxEventType.STREAM_EVENT_CREATED, {
          event_id: eventId,
          stream_id: params.streamId,
          workspace_id: stream.workspace_id,
          stream_type: stream.stream_type,
          stream_slug: stream.slug,
          event_type: params.eventType,
          actor_id: params.actorId || null,
          agent_id: params.agentId || null,
          content: params.content,
          mentions: params.mentions,
          payload: params.payload,
          client_message_id: params.clientMessageId,
        })

        // Update read cursor for the author (only for user events, not agent events)
        if (params.actorId) {
          await StreamMemberRepository.updateReadCursor(client, params.streamId, params.actorId, eventId)

          // Emit read cursor update so other devices see the message as read
          await publishOutboxEvent(client, OutboxEventType.READ_CURSOR_UPDATED, {
            stream_id: params.streamId,
            user_id: params.actorId,
            event_id: eventId,
            workspace_id: stream.workspace_id,
          })
        }

        return { type: "created", eventId, contentId, stream }
      })

      // Handle idempotent case - event already existed
      if (result.type === "idempotent") {
        return result.event
      }

      // Post-transaction work
      logger.info(
        { eventId: result.eventId, streamId: params.streamId, type: params.eventType, isAgent: !!params.agentId },
        "Event created",
      )

      // Retry auto-naming for unnamed threads/thinking spaces after enough context
      // This runs async outside the transaction to not block the response
      if (
        (result.stream.stream_type === "thread" || result.stream.stream_type === "thinking_space") &&
        !result.stream.name
      ) {
        this.retryAutoNameIfNeeded(params.streamId, result.stream.workspace_id).catch((err) => {
          logger.warn({ err, streamId: params.streamId }, "Failed to retry auto-naming")
        })
      }

      // Queue classification for text messages to proactively identify valuable content
      // This enables early enrichment for announcements, explanations, and decisions
      if (params.eventType === "message" && params.content && result.contentId && params.actorId) {
        maybeQueueClassification({
          workspaceId: result.stream.workspace_id,
          streamId: params.streamId,
          eventId: result.eventId,
          textMessageId: result.contentId,
          content: params.content,
          contentType: "message",
        }).catch((err) => {
          logger.warn({ err, eventId: result.eventId }, "Failed to queue classification")
        })
      }

      return (await this.getEventWithDetails(result.eventId))!
    } catch (error) {
      // Handle duplicate key error on client_message_id (race condition during retry)
      // If another request already created the event, fetch and return it
      const pgError = error as { code?: string; constraint?: string }
      if (
        pgError.code === "23505" &&
        pgError.constraint === "idx_stream_events_client_message_id" &&
        params.clientMessageId
      ) {
        logger.debug(
          { clientMessageId: params.clientMessageId, streamId: params.streamId },
          "Duplicate client_message_id detected, fetching existing event",
        )
        const client = await this.pool.connect()
        try {
          const existingRow = await StreamEventRepository.findEventByClientMessageId(
            client,
            params.streamId,
            params.clientMessageId,
          )
          if (existingRow) {
            return this.mapEventRow(existingRow)
          }
        } finally {
          client.release()
        }
      }

      throw error
    }
  }

  async getStreamEvents(streamId: string, limit: number = 50, offset: number = 0): Promise<StreamEventWithDetails[]> {
    const client = await this.pool.connect()
    try {
      const rows = await StreamEventRepository.findEventsByStreamId(client, streamId, { limit, offset })

      // Reverse for chronological order
      const events = rows.reverse()

      // Hydrate shared refs with original events
      const sharedEvents = events.filter((e) => e.content_type === "shared_ref" && e.original_event_id)
      if (sharedEvents.length > 0) {
        const originalIds = sharedEvents.map((e) => e.original_event_id!)
        const originals = await StreamEventRepository.findEventsByIds(client, originalIds)

        const originalMap = new Map(originals.map((o) => [o.id, o]))
        for (const event of sharedEvents) {
          const original = originalMap.get(event.original_event_id!)
          if (original) {
            ;(event as any).original_event = this.mapEventRow(original)
          }
        }
      }

      return events.map((row) => this.mapEventRow(row))
    } finally {
      client.release()
    }
  }

  async getEventWithDetails(eventId: string): Promise<StreamEventWithDetails | null> {
    const client = await this.pool.connect()
    try {
      const row = await StreamEventRepository.findEventWithDetails(client, eventId)
      if (!row) return null

      // Hydrate shared ref if needed (recursive call is OK - it uses pool.connect)
      if (row.content_type === "shared_ref" && row.original_event_id) {
        const original = await this.getEventWithDetails(row.original_event_id)
        if (original) {
          ;(row as any).original_event = original
        }
      }

      return this.mapEventRow(row)
    } finally {
      client.release()
    }
  }

  async editEvent(eventId: string, userId: string, newContent: string): Promise<StreamEventWithDetails> {
    await withTransaction(this.pool, async (client) => {
      const eventRow = await StreamEventRepository.findEventWithStream(client, eventId)

      if (!eventRow) throw new Error("Event not found")
      if (eventRow.actor_id !== userId) throw new Error("Can only edit your own events")
      if (eventRow.event_type !== "message") throw new Error("Can only edit message events")
      if (!eventRow.content_id) throw new Error("Event has no content to edit")

      // Get old content for revision
      const oldContent = await TextMessageRepository.findTextMessageById(client, eventRow.content_id)

      // Create revision
      const revisionId = generateId("rev")
      await MessageRevisionRepository.insertRevision(client, {
        id: revisionId,
        messageId: eventRow.content_id,
        content: oldContent?.content || "",
      })

      // Update content
      await TextMessageRepository.updateTextMessageContent(client, eventRow.content_id, newContent)

      // Update event timestamp
      await StreamEventRepository.updateEventEditedAt(client, eventId)

      // Emit outbox event
      await publishOutboxEvent(client, OutboxEventType.STREAM_EVENT_EDITED, {
        event_id: eventId,
        stream_id: eventRow.stream_id,
        workspace_id: eventRow.workspace_id,
        content: newContent,
        edited_at: new Date().toISOString(),
      })
    })

    return (await this.getEventWithDetails(eventId))!
  }

  async deleteEvent(eventId: string, userId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const eventRow = await StreamEventRepository.findEventWithStream(client, eventId)

      if (!eventRow) throw new Error("Event not found")
      if (eventRow.actor_id !== userId) throw new Error("Can only delete your own events")

      await StreamEventRepository.softDeleteEvent(client, eventId)

      await publishOutboxEvent(client, OutboxEventType.STREAM_EVENT_DELETED, {
        event_id: eventId,
        stream_id: eventRow.stream_id,
        workspace_id: eventRow.workspace_id,
      })
    })
  }

  // ==========================================================================
  // Membership Operations
  // ==========================================================================

  async joinStream(streamId: string, userId: string): Promise<{ stream: Stream; event: StreamEventWithDetails }> {
    const { streamRow, eventId } = await withTransaction(this.pool, async (client) => {
      await StreamMemberRepository.upsertMember(client, { streamId, userId, role: "member" })

      const eventId = generateId("event")
      await StreamEventRepository.insertEvent(client, {
        id: eventId,
        streamId,
        eventType: "member_joined",
        actorId: userId,
        payload: { user_id: userId },
      })

      await StreamMemberRepository.updateReadCursor(client, streamId, userId, eventId)

      const streamRow = await StreamRepository.findStreamById(client, streamId)
      if (!streamRow) {
        throw new Error("Stream not found")
      }

      await publishOutboxEvent(client, OutboxEventType.STREAM_EVENT_CREATED, {
        event_id: eventId,
        stream_id: streamId,
        workspace_id: streamRow.workspace_id,
        stream_slug: streamRow.slug,
        event_type: "member_joined",
        actor_id: userId,
      })

      await publishOutboxEvent(client, OutboxEventType.STREAM_MEMBER_ADDED, {
        stream_id: streamId,
        stream_name: streamRow.name,
        stream_slug: streamRow.slug,
        workspace_id: streamRow.workspace_id,
        user_id: userId,
        added_by_user_id: userId,
      })

      return { streamRow, eventId }
    })

    const stream = this.mapStreamRow(streamRow)
    const event = await this.getEventWithDetails(eventId)

    return { stream, event: event! }
  }

  async leaveStream(streamId: string, userId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await StreamMemberRepository.removeMember(client, streamId, userId)

      const eventId = generateId("event")
      await StreamEventRepository.insertEvent(client, {
        id: eventId,
        streamId,
        eventType: "member_left",
        actorId: userId,
        payload: { user_id: userId },
      })

      const streamRow = await StreamRepository.findStreamById(client, streamId)
      if (!streamRow) {
        throw new Error("Stream not found")
      }

      await publishOutboxEvent(client, OutboxEventType.STREAM_EVENT_CREATED, {
        event_id: eventId,
        stream_id: streamId,
        workspace_id: streamRow.workspace_id,
        stream_slug: streamRow.slug,
        event_type: "member_left",
        actor_id: userId,
      })

      await publishOutboxEvent(client, OutboxEventType.STREAM_MEMBER_REMOVED, {
        stream_id: streamId,
        stream_name: streamRow.name,
        workspace_id: streamRow.workspace_id,
        user_id: userId,
        removed_by_user_id: userId,
      })
    })
  }

  async addMember(streamId: string, userId: string, addedByUserId: string, role: MemberRole = "member"): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await StreamMemberRepository.upsertMember(client, {
        streamId,
        userId,
        role,
        addedByUserId,
      })

      const eventId = generateId("event")
      await StreamEventRepository.insertEvent(client, {
        id: eventId,
        streamId,
        eventType: "member_joined",
        actorId: addedByUserId,
        payload: { user_id: userId, added_by: addedByUserId },
      })

      const streamRow = await StreamRepository.findStreamById(client, streamId)
      if (!streamRow) {
        throw new Error("Stream not found")
      }

      await publishOutboxEvent(client, OutboxEventType.STREAM_MEMBER_ADDED, {
        stream_id: streamId,
        stream_name: streamRow.name,
        stream_slug: streamRow.slug,
        workspace_id: streamRow.workspace_id,
        user_id: userId,
        added_by_user_id: addedByUserId,
      })
    })
  }

  async removeMember(streamId: string, userId: string, removedByUserId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await StreamMemberRepository.removeMember(client, streamId, userId)

      const eventId = generateId("event")
      await StreamEventRepository.insertEvent(client, {
        id: eventId,
        streamId,
        eventType: "member_left",
        actorId: removedByUserId,
        payload: { user_id: userId, removed_by: removedByUserId },
      })

      const streamRow = await StreamRepository.findStreamById(client, streamId)
      if (!streamRow) {
        throw new Error("Stream not found")
      }

      await publishOutboxEvent(client, OutboxEventType.STREAM_MEMBER_REMOVED, {
        stream_id: streamId,
        stream_name: streamRow.name,
        workspace_id: streamRow.workspace_id,
        user_id: userId,
        removed_by_user_id: removedByUserId,
      })
    })
  }

  async getStreamMembers(streamId: string): Promise<Array<StreamMember & { email: string; name: string }>> {
    const client = await this.pool.connect()
    try {
      const rows = await StreamMemberRepository.findStreamMembers(client, streamId)
      return rows.map((row) => ({
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
    } finally {
      client.release()
    }
  }

  // ==========================================================================
  // Read State
  // ==========================================================================

  async updateReadCursor(streamId: string, userId: string, eventId: string, workspaceId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await StreamMemberRepository.updateReadCursor(client, streamId, userId, eventId)

      await publishOutboxEvent(client, OutboxEventType.READ_CURSOR_UPDATED, {
        stream_id: streamId,
        workspace_id: workspaceId,
        user_id: userId,
        event_id: eventId,
      })
    })
  }

  async getReadCursor(streamId: string, userId: string): Promise<string | null> {
    const client = await this.pool.connect()
    try {
      return await StreamMemberRepository.getReadCursor(client, streamId, userId)
    } finally {
      client.release()
    }
  }

  // ==========================================================================
  // Notifications
  // ==========================================================================

  async getNotificationCount(workspaceId: string, userId: string): Promise<number> {
    const client = await this.pool.connect()
    try {
      return await NotificationRepository.countUnreadNotifications(client, workspaceId, userId)
    } finally {
      client.release()
    }
  }

  async getNotifications(workspaceId: string, userId: string, limit: number = 50): Promise<any[]> {
    const client = await this.pool.connect()
    try {
      const rows = await NotificationRepository.findNotifications(client, workspaceId, userId, limit)
      return rows.map((row) => ({
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
    } finally {
      client.release()
    }
  }

  async markNotificationAsRead(notificationId: string, userId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await NotificationRepository.markNotificationRead(client, notificationId, userId)
    } finally {
      client.release()
    }
  }

  async markAllNotificationsAsRead(workspaceId: string, userId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await NotificationRepository.markAllNotificationsRead(client, workspaceId, userId)
    } finally {
      client.release()
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  async getUserEmail(userId: string): Promise<string | null> {
    const result = await this.pool.query(sql`SELECT email FROM users WHERE id = ${userId}`)
    return result.rows[0]?.email || null
  }

  async checkSlugExists(workspaceId: string, slug: string, excludeStreamId?: string): Promise<boolean> {
    const client = await this.pool.connect()
    try {
      return await StreamRepository.slugExists(client, workspaceId, slug, excludeStreamId)
    } finally {
      client.release()
    }
  }

  /**
   * Check if a user has access to a stream using recursive CTE for efficient graph traversal.
   * Access can be granted through:
   * 1. Direct membership in the target stream
   * 2. Membership in any ancestor stream (channel/thinking_space)
   * 3. Cross-post access: if content was cross-posted INTO this stream from another stream
   *    the user has access to, they can access this stream too
   */
  async checkStreamAccess(streamId: string, userId: string): Promise<StreamAccessResult> {
    // Use recursive CTE to traverse the parent chain in a single query
    // This finds all ancestors and checks membership at each level
    const result = await this.pool.query(
      sql`WITH RECURSIVE stream_chain AS (
            -- Base case: the requested stream
            SELECT
              s.id,
              s.visibility,
              s.stream_type,
              s.parent_stream_id,
              CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
              0 as depth,
              s.id as chain_id
            FROM streams s
            LEFT JOIN stream_members sm ON s.id = sm.stream_id
              AND sm.user_id = ${userId}
              AND sm.left_at IS NULL
            WHERE s.id = ${streamId}

            UNION ALL

            -- Recursive case: traverse to parent streams
            SELECT
              p.id,
              p.visibility,
              p.stream_type,
              p.parent_stream_id,
              CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
              sc.depth + 1,
              p.id as chain_id
            FROM stream_chain sc
            INNER JOIN streams p ON p.id = sc.parent_stream_id
            LEFT JOIN stream_members sm ON p.id = sm.stream_id
              AND sm.user_id = ${userId}
              AND sm.left_at IS NULL
            WHERE sc.depth < 10  -- Max 10 levels to prevent infinite loops
          )
          SELECT * FROM stream_chain
          ORDER BY depth`,
    )

    if (result.rows.length === 0) {
      return { hasAccess: false, isMember: false, canPost: false, reason: "Stream not found" }
    }

    const targetStream = result.rows[0]

    // Direct member of the target stream - full access
    if (targetStream.is_member) {
      return { hasAccess: true, isMember: true, canPost: true }
    }

    // For threads, check if user is member of any ancestor channel/thinking_space
    if (targetStream.stream_type === "thread") {
      for (const ancestor of result.rows) {
        if (ancestor.depth === 0) continue // Skip target stream itself

        // Found a channel or thinking space ancestor where user is a member
        if ((ancestor.stream_type === "channel" || ancestor.stream_type === "thinking_space") && ancestor.is_member) {
          return {
            hasAccess: true,
            isMember: false,
            canPost: true,
            inheritedFrom: ancestor.id,
          }
        }
      }

      // Check cross-post access: if content was cross-posted INTO this stream
      // from another stream the user has access to
      const crossPostAccess = await this.checkCrossPostAccess(streamId, userId)
      if (crossPostAccess.hasAccess) {
        return crossPostAccess
      }
    }

    // Non-members can read public streams but not post
    if (targetStream.visibility === "public") {
      return {
        hasAccess: true,
        isMember: false,
        canPost: false,
        reason: "You need to join this channel to post messages",
      }
    }

    // For threads with 'inherit' visibility, check if parent chain has public visibility
    if (targetStream.visibility === "inherit") {
      for (const ancestor of result.rows) {
        if (ancestor.depth === 0) continue
        if (ancestor.visibility === "public") {
          return {
            hasAccess: true,
            isMember: false,
            canPost: false,
            reason: "You need to join to post messages",
          }
        }
        // Stop at first non-inherit ancestor
        if (ancestor.visibility !== "inherit") break
      }
    }

    // Non-members cannot access private streams
    return {
      hasAccess: false,
      isMember: false,
      canPost: false,
      reason: "This is a private channel",
    }
  }

  /**
   * Check if user has access through cross-posts.
   * If content was cross-posted INTO this stream from another stream the user can access,
   * they get access to this stream too.
   */
  private async checkCrossPostAccess(streamId: string, userId: string): Promise<StreamAccessResult> {
    // Find all source streams that have cross-posted content INTO this stream
    // by looking at shared_refs in this stream's events
    const crossPostSources = await this.pool.query(
      sql`SELECT DISTINCT source_event.stream_id as source_stream_id
          FROM stream_events e
          INNER JOIN shared_refs sr ON e.content_type = 'shared_ref' AND e.content_id = sr.id
          INNER JOIN stream_events source_event ON sr.original_event_id = source_event.id
          WHERE e.stream_id = ${streamId}
            AND e.deleted_at IS NULL`,
    )

    // Check if user has access to any of the source streams
    for (const source of crossPostSources.rows) {
      // Recursively check access to the source stream (but don't check cross-posts again to avoid loops)
      const sourceAccess = await this.checkStreamAccessDirect(source.source_stream_id, userId)
      if (sourceAccess.hasAccess) {
        return {
          hasAccess: true,
          isMember: false,
          canPost: true,
          inheritedFrom: source.source_stream_id,
        }
      }
    }

    return { hasAccess: false, isMember: false, canPost: false }
  }

  /**
   * Check stream access via parent chain only (no cross-post recursion).
   * Used internally to avoid infinite loops when checking cross-post access.
   */
  private async checkStreamAccessDirect(streamId: string, userId: string): Promise<StreamAccessResult> {
    const result = await this.pool.query(
      sql`WITH RECURSIVE stream_chain AS (
            SELECT
              s.id, s.visibility, s.stream_type, s.parent_stream_id,
              CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
              0 as depth
            FROM streams s
            LEFT JOIN stream_members sm ON s.id = sm.stream_id
              AND sm.user_id = ${userId} AND sm.left_at IS NULL
            WHERE s.id = ${streamId}
            UNION ALL
            SELECT
              p.id, p.visibility, p.stream_type, p.parent_stream_id,
              CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
              sc.depth + 1
            FROM stream_chain sc
            INNER JOIN streams p ON p.id = sc.parent_stream_id
            LEFT JOIN stream_members sm ON p.id = sm.stream_id
              AND sm.user_id = ${userId} AND sm.left_at IS NULL
            WHERE sc.depth < 10
          )
          SELECT * FROM stream_chain ORDER BY depth`,
    )

    if (result.rows.length === 0) {
      return { hasAccess: false, isMember: false, canPost: false }
    }

    const targetStream = result.rows[0]

    if (targetStream.is_member) {
      return { hasAccess: true, isMember: true, canPost: true }
    }

    // Check ancestor membership
    for (const ancestor of result.rows) {
      if (ancestor.depth === 0) continue
      if ((ancestor.stream_type === "channel" || ancestor.stream_type === "thinking_space") && ancestor.is_member) {
        return { hasAccess: true, isMember: false, canPost: true, inheritedFrom: ancestor.id }
      }
    }

    return { hasAccess: false, isMember: false, canPost: false }
  }

  /**
   * Check if user has access to reply to an event (for pending threads).
   * This checks access to the event's parent stream.
   */
  async checkEventAccess(eventId: string, userId: string): Promise<StreamAccessResult> {
    // Get the event's stream ID
    const result = await this.pool.query(sql`SELECT stream_id FROM stream_events WHERE id = ${eventId}`)

    if (result.rows.length === 0) {
      return { hasAccess: false, isMember: false, canPost: false, reason: "Event not found" }
    }

    return this.checkStreamAccess(result.rows[0].stream_id, userId)
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
    const client = await this.pool.connect()
    try {
      await StreamMemberRepository.pinStream(client, streamId, userId)
    } finally {
      client.release()
    }
  }

  /**
   * Unpin a stream for a user
   */
  async unpinStream(streamId: string, userId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await StreamMemberRepository.unpinStream(client, streamId, userId)
    } finally {
      client.release()
    }
  }

  // ==========================================================================
  // Auto-naming
  // ==========================================================================

  /**
   * Retry auto-naming for threads/thinking spaces that don't have a name yet.
   * This is called after new messages are added to give the namer more context.
   */
  private async retryAutoNameIfNeeded(streamId: string, workspaceId: string): Promise<void> {
    // Get message count for this stream
    const countResult = await this.pool.query(
      sql`SELECT COUNT(*)::int as count FROM stream_events
          WHERE stream_id = ${streamId}
            AND event_type = 'message'
            AND deleted_at IS NULL`,
    )

    const messageCount = countResult.rows[0]?.count || 0

    // Only retry after 3+ messages to have enough context
    if (messageCount < 3) {
      return
    }

    // Check if stream still has no name
    const streamResult = await this.pool.query(sql`SELECT name, stream_type FROM streams WHERE id = ${streamId}`)

    const stream = streamResult.rows[0]
    if (!stream || stream.name) {
      return // Already has a name
    }

    // Fetch recent messages for context
    const messagesResult = await this.pool.query(
      sql`SELECT tm.content
          FROM stream_events e
          INNER JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
          WHERE e.stream_id = ${streamId}
            AND e.event_type = 'message'
            AND e.deleted_at IS NULL
          ORDER BY e.created_at ASC
          LIMIT 5`,
    )

    if (messagesResult.rows.length === 0) {
      return
    }

    // Combine messages for naming context
    const combinedContent = messagesResult.rows
      .map((r) => r.content)
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 3000) // Limit to 3000 chars

    try {
      const nameResult = await generateAutoName(combinedContent)
      if (nameResult.success && nameResult.name) {
        // Update stream name
        await this.pool.query(
          sql`UPDATE streams SET name = ${nameResult.name}, updated_at = NOW() WHERE id = ${streamId}`,
        )

        // Emit stream.updated event
        const client = await this.pool.connect()
        try {
          const updateOutboxId = generateId("outbox")
          await client.query(
            sql`INSERT INTO outbox (id, event_type, payload)
                VALUES (${updateOutboxId}, 'stream.updated', ${JSON.stringify({
                  stream_id: streamId,
                  workspace_id: workspaceId,
                  name: nameResult.name,
                  updated_by: "system",
                })})`,
          )
          await client.query(`NOTIFY outbox_event, '${updateOutboxId.replace(/'/g, "''")}'`)
        } finally {
          client.release()
        }

        logger.info({ streamId, name: nameResult.name, messageCount }, "Stream auto-named on retry")
      }
    } catch (err) {
      logger.warn({ err, streamId }, "Failed to auto-name stream on retry")
    }
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
      agentId: row.agent_id,
      contentType: row.content_type,
      contentId: row.content_id,
      payload: row.payload,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deletedAt: row.deleted_at,
      actorEmail: row.actor_email,
      actorName: row.actor_name || row.agent_name, // Use agent name if no actor
      agentName: row.agent_name,
      content: row.content,
      mentions: row.mentions,
      originalEventId: row.original_event_id,
      shareContext: row.share_context,
      originalEvent: row.original_event,
      replyCount: parseInt(row.reply_count || "0", 10),
      isEdited: Boolean(row.edited_at),
    }
  }

  // ==========================================================================
  // Reactions
  // ==========================================================================

  /**
   * Add a reaction to a message.
   */
  async addReaction(eventId: string, userId: string, reaction: string): Promise<void> {
    const txResult = await withTransaction(this.pool, async (client) => {
      // Get event info for workspace and content
      const eventRow = await StreamEventRepository.findEventWithStream(client, eventId)
      if (!eventRow) {
        throw new Error("Event not found")
      }

      // Insert reaction (upsert to handle duplicates)
      const reactionId = generateId("msgr")
      await ReactionRepository.insertReaction(client, {
        id: reactionId,
        messageId: eventId,
        userId,
        reaction,
      })

      // Get updated reaction count
      const reactionCount = await ReactionRepository.countReactionsByMessageId(client, eventId)

      // Emit outbox event for real-time updates
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, 'reaction.added', ${JSON.stringify({
              event_id: eventId,
              stream_id: eventRow.stream_id,
              workspace_id: eventRow.workspace_id,
              user_id: userId,
              reaction,
              reaction_count: reactionCount,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      return { event: eventRow, reactionCount }
    })

    // Queue enrichment if this is a text message with enough reactions
    if (txResult.event.content_type === "text_message" && txResult.event.content_id) {
      queueEnrichmentForReaction({
        workspaceId: txResult.event.workspace_id,
        eventId,
        textMessageId: txResult.event.content_id,
        reactionCount: txResult.reactionCount,
      }).catch((err) => {
        logger.warn({ err, eventId }, "Failed to queue enrichment for reaction")
      })
    }

    logger.debug({ eventId, userId, reaction, reactionCount: txResult.reactionCount }, "Reaction added")
  }

  /**
   * Remove a reaction from a message.
   */
  async removeReaction(eventId: string, userId: string, reaction: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      // Get event info for workspace
      const eventRow = await StreamEventRepository.findEventWithStream(client, eventId)
      if (!eventRow) {
        throw new Error("Event not found")
      }

      // Soft delete the reaction
      await ReactionRepository.softDeleteReaction(client, eventId, userId, reaction)

      // Get updated reaction count
      const reactionCount = await ReactionRepository.countReactionsByMessageId(client, eventId)

      // Emit outbox event
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, 'reaction.removed', ${JSON.stringify({
              event_id: eventId,
              stream_id: eventRow.stream_id,
              workspace_id: eventRow.workspace_id,
              user_id: userId,
              reaction,
              reaction_count: reactionCount,
            })})`,
      )
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      logger.debug({ eventId, userId, reaction }, "Reaction removed")
    })
  }

  /**
   * Get reactions for an event.
   */
  async getReactions(eventId: string): Promise<Array<{ userId: string; reaction: string; createdAt: Date }>> {
    const client = await this.pool.connect()
    try {
      const rows = await ReactionRepository.findReactionsByMessageId(client, eventId)
      return rows.map((r) => ({
        userId: r.user_id,
        reaction: r.reaction,
        createdAt: r.created_at,
      }))
    } finally {
      client.release()
    }
  }

  /**
   * Get reaction count for an event.
   */
  async getReactionCount(eventId: string): Promise<number> {
    const client = await this.pool.connect()
    try {
      return await ReactionRepository.countReactionsByMessageId(client, eventId)
    } finally {
      client.release()
    }
  }
}
