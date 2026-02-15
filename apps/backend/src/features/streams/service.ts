import { z } from "zod"
import { Pool } from "pg"
import { withClient, withTransaction } from "../../db"
import { StreamRepository, Stream, StreamWithPreview, LastMessagePreview } from "./repository"
import { StreamMemberRepository, StreamMember } from "./member-repository"
import { StreamEventRepository } from "./event-repository"
import { MessageRepository } from "../messaging"
import { OutboxRepository } from "../../lib/outbox"
import { streamId, eventId } from "../../lib/id"
import {
  DuplicateSlugError,
  HttpError,
  StreamNotFoundError,
  MessageNotFoundError,
  isUniqueViolation,
} from "../../lib/errors"
import { formatParticipantNames } from "./display-name"
import { MemberRepository } from "../workspaces"
import {
  StreamTypes,
  Visibilities,
  CompanionModes,
  type StreamType,
  type Visibility,
  type CompanionMode,
  type NotificationLevel,
} from "@threa/types"
import { streamTypeSchema, visibilitySchema, companionModeSchema } from "../../lib/schemas"
import { isAllowedLevel } from "./notification-config"

const createScratchpadParamsSchema = z.object({
  workspaceId: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  createdBy: z.string(),
  companionMode: companionModeSchema.optional(),
  companionPersonaId: z.string().optional(),
})

export type CreateScratchpadParams = z.infer<typeof createScratchpadParamsSchema>

const createChannelParamsSchema = z.object({
  workspaceId: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  visibility: visibilitySchema.optional(),
  createdBy: z.string(),
})

export type CreateChannelParams = z.infer<typeof createChannelParamsSchema>

const createThreadParamsSchema = z.object({
  workspaceId: z.string(),
  parentStreamId: z.string(),
  parentMessageId: z.string(),
  createdBy: z.string(),
})

export type CreateThreadParams = z.infer<typeof createThreadParamsSchema>

const createStreamParamsSchema = z.object({
  workspaceId: z.string(),
  type: streamTypeSchema,
  slug: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  visibility: visibilitySchema.optional(),
  companionMode: companionModeSchema.optional(),
  companionPersonaId: z.string().optional(),
  parentStreamId: z.string().optional(),
  parentMessageId: z.string().optional(),
  createdBy: z.string(),
})

export type CreateStreamParams = z.infer<typeof createStreamParamsSchema>

export class StreamService {
  constructor(private pool: Pool) {}

  async getStreamById(id: string): Promise<Stream | null> {
    return StreamRepository.findById(this.pool, id)
  }

  async validateStreamAccess(streamId: string, workspaceId: string, memberId: string): Promise<Stream> {
    const stream = await this.checkAccess(streamId, workspaceId, memberId)
    if (!stream) throw new StreamNotFoundError()
    return stream
  }

  private async checkAccess(streamId: string, workspaceId: string, memberId: string): Promise<Stream | null> {
    return withClient(this.pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream || stream.workspaceId !== workspaceId) return null

      if (stream.rootStreamId) {
        const rootStream = await StreamRepository.findById(client, stream.rootStreamId)
        if (!rootStream) return null

        if (rootStream.visibility !== Visibilities.PUBLIC) {
          const isRootMember = await StreamMemberRepository.isMember(client, stream.rootStreamId, memberId)
          if (!isRootMember) return null
        }

        return stream
      }

      if (stream.visibility !== Visibilities.PUBLIC) {
        const isMember = await StreamMemberRepository.isMember(client, streamId, memberId)
        if (!isMember) return null
      }

      return stream
    })
  }

  async getScratchpadsByMember(workspaceId: string, memberId: string): Promise<Stream[]> {
    return withClient(this.pool, async (client) => {
      const memberships = await StreamMemberRepository.list(client, { memberId })
      const streamIds = memberships.map((m) => m.streamId)

      if (streamIds.length === 0) return []

      const streams = await StreamRepository.list(client, workspaceId, {
        types: [StreamTypes.SCRATCHPAD],
      })
      return streams.filter((s) => streamIds.includes(s.id))
    })
  }

  async getStreamsByWorkspace(workspaceId: string): Promise<Stream[]> {
    return StreamRepository.list(this.pool, workspaceId)
  }

  async list(
    workspaceId: string,
    memberId: string,
    filters?: { types?: StreamType[]; archiveStatus?: ("active" | "archived")[] }
  ): Promise<Stream[]> {
    return withClient(this.pool, async (client) => {
      const memberships = await StreamMemberRepository.list(client, { memberId })
      const memberStreamIds = memberships.map((m) => m.streamId)

      return StreamRepository.list(client, workspaceId, {
        types: filters?.types,
        archiveStatus: filters?.archiveStatus,
        userMembershipStreamIds: memberStreamIds,
      })
    })
  }

  /**
   * List streams with last message preview for sidebar display.
   * Ordered by most recent activity (last message or stream creation).
   */
  async listWithPreviews(
    workspaceId: string,
    memberId: string,
    filters?: { types?: StreamType[]; archiveStatus?: ("active" | "archived")[] }
  ): Promise<StreamWithPreview[]> {
    return withClient(this.pool, async (client) => {
      const memberships = await StreamMemberRepository.list(client, { memberId })
      const memberStreamIds = memberships.map((m) => m.streamId)

      return StreamRepository.listWithPreviews(client, workspaceId, {
        types: filters?.types,
        archiveStatus: filters?.archiveStatus,
        userMembershipStreamIds: memberStreamIds,
      })
    })
  }

  /**
   * Resolve DM display names for bootstrap. DMs have null displayName in the DB
   * because the name is viewer-dependent ("Max" vs "Sam" depending on who's looking).
   * This populates displayName with formatted participant names for the viewing member.
   */
  async resolveDmDisplayNames(
    streams: StreamWithPreview[],
    workspaceMembers: { id: string; name: string }[],
    viewingMemberId: string
  ): Promise<StreamWithPreview[]> {
    const dmStreams = streams.filter((s) => s.type === "dm")
    if (dmStreams.length === 0) return streams

    const dmStreamIds = dmStreams.map((s) => s.id)
    const allDmMembers = await StreamMemberRepository.list(this.pool, { streamIds: dmStreamIds })

    const memberNameMap = new Map(workspaceMembers.map((m) => [m.id, m.name]))

    const membersByStream = new Map<string, { id: string; name: string }[]>()
    for (const sm of allDmMembers) {
      const name = memberNameMap.get(sm.memberId)
      if (!name) continue
      const list = membersByStream.get(sm.streamId) ?? []
      list.push({ id: sm.memberId, name })
      membersByStream.set(sm.streamId, list)
    }

    const dmNameMap = new Map<string, string>()
    for (const dm of dmStreams) {
      const participants = membersByStream.get(dm.id) ?? []
      dmNameMap.set(dm.id, formatParticipantNames(participants, viewingMemberId))
    }

    return streams.map((s) => (dmNameMap.has(s.id) ? { ...s, displayName: dmNameMap.get(s.id)! } : s))
  }

  async create(params: CreateStreamParams): Promise<Stream> {
    switch (params.type) {
      case StreamTypes.SCRATCHPAD:
        return this.createScratchpad({
          workspaceId: params.workspaceId,
          displayName: params.displayName,
          description: params.description,
          companionMode: params.companionMode,
          companionPersonaId: params.companionPersonaId,
          createdBy: params.createdBy,
        })
      case StreamTypes.CHANNEL:
        if (!params.slug) {
          throw new Error("Slug is required for channels")
        }
        return this.createChannel({
          workspaceId: params.workspaceId,
          slug: params.slug,
          description: params.description,
          visibility: params.visibility,
          createdBy: params.createdBy,
        })
      case StreamTypes.THREAD:
        if (!params.parentStreamId || !params.parentMessageId) {
          throw new Error("parentStreamId and parentMessageId are required for threads")
        }
        return this.createThread({
          workspaceId: params.workspaceId,
          parentStreamId: params.parentStreamId,
          parentMessageId: params.parentMessageId,
          createdBy: params.createdBy,
        })
      default:
        throw new Error(`Unsupported stream type for create: ${params.type}`)
    }
  }

  async createScratchpad(params: CreateScratchpadParams): Promise<Stream> {
    return withTransaction(this.pool, async (client) => {
      const id = streamId()

      const stream = await StreamRepository.insert(client, {
        id,
        workspaceId: params.workspaceId,
        type: StreamTypes.SCRATCHPAD,
        displayName: params.displayName,
        description: params.description,
        visibility: Visibilities.PRIVATE,
        companionMode: params.companionMode ?? CompanionModes.OFF,
        companionPersonaId: params.companionPersonaId,
        createdBy: params.createdBy,
      })

      // Add creator as member
      await StreamMemberRepository.insert(client, id, params.createdBy)

      // Publish to outbox for real-time delivery
      await OutboxRepository.insert(client, "stream:created", {
        workspaceId: params.workspaceId,
        streamId: stream.id,
        stream,
      })

      return stream
    })
  }

  async createChannel(params: CreateChannelParams): Promise<Stream> {
    return withTransaction(this.pool, async (client) => {
      const id = streamId()

      // Check if slug already exists
      const slugExists = await StreamRepository.slugExistsInWorkspace(client, params.workspaceId, params.slug)
      if (slugExists) {
        throw new DuplicateSlugError(params.slug)
      }

      const stream = await StreamRepository.insert(client, {
        id,
        workspaceId: params.workspaceId,
        type: StreamTypes.CHANNEL,
        // Channels use slug as display name, no separate displayName field
        slug: params.slug,
        description: params.description,
        visibility: params.visibility ?? Visibilities.PUBLIC,
        createdBy: params.createdBy,
      })

      // Add creator as member
      await StreamMemberRepository.insert(client, id, params.createdBy)

      // Publish to outbox for real-time delivery
      await OutboxRepository.insert(client, "stream:created", {
        workspaceId: params.workspaceId,
        streamId: stream.id,
        stream,
      })

      return stream
    })
  }

  async createThread(params: CreateThreadParams): Promise<Stream> {
    return withTransaction(this.pool, async (client) => {
      // Get parent stream to determine root (needed for insert)
      const parentStream = await StreamRepository.findById(client, params.parentStreamId)
      if (!parentStream || parentStream.workspaceId !== params.workspaceId) {
        throw new StreamNotFoundError()
      }

      // Validate that parentMessageId exists in the parent stream
      const parentMessage = await MessageRepository.findById(client, params.parentMessageId)
      if (!parentMessage || parentMessage.streamId !== params.parentStreamId) {
        throw new MessageNotFoundError()
      }

      // Root is either the parent's root (if parent is a thread) or the parent itself
      const rootStreamId = parentStream.rootStreamId ?? parentStream.id

      const id = streamId()

      // Atomically insert or find existing thread
      // Uses ON CONFLICT DO NOTHING to handle race conditions
      // Inherit visibility from the root stream — threads in public channels
      // are public, threads in private DMs/scratchpads stay private.
      const rootStream =
        rootStreamId === parentStream.id ? parentStream : await StreamRepository.findById(client, rootStreamId)
      const inheritedVisibility = rootStream?.visibility ?? Visibilities.PRIVATE

      const { stream, created } = await StreamRepository.insertThreadOrFind(client, {
        id,
        workspaceId: params.workspaceId,
        type: StreamTypes.THREAD,
        parentStreamId: params.parentStreamId,
        parentMessageId: params.parentMessageId,
        rootStreamId,
        visibility: inheritedVisibility,
        createdBy: params.createdBy,
      })

      // Add creator as member (idempotent - handles existing membership)
      const isMember = await StreamMemberRepository.isMember(client, stream.id, params.createdBy)
      if (!isMember) {
        await StreamMemberRepository.insert(client, stream.id, params.createdBy)
      }

      // Add parent message author as member so they can participate in the thread
      if (parentMessage.authorType === "member" && parentMessage.authorId !== params.createdBy) {
        const authorIsMember = await StreamMemberRepository.isMember(client, stream.id, parentMessage.authorId)
        if (!authorIsMember) {
          await StreamMemberRepository.insert(client, stream.id, parentMessage.authorId)
        }
      }

      // Only broadcast if we created a new thread
      if (created) {
        // Broadcast stream:created to PARENT stream's room (not the new thread's room)
        // This lets watchers of the parent see the thread indicator appear
        await OutboxRepository.insert(client, "stream:created", {
          workspaceId: params.workspaceId,
          streamId: params.parentStreamId,
          stream,
        })
      }

      return stream
    })
  }

  async updateCompanionMode(
    streamId: string,
    companionMode: CompanionMode,
    companionPersonaId?: string | null
  ): Promise<Stream> {
    return withTransaction(this.pool, async (client) => {
      const stream = await StreamRepository.update(client, streamId, {
        companionMode,
        companionPersonaId,
      })
      if (!stream) {
        throw new Error("Stream not found")
      }
      await OutboxRepository.insert(client, "stream:updated", {
        workspaceId: stream.workspaceId,
        streamId: stream.id,
        stream,
      })
      return stream
    })
  }

  async archiveStream(streamId: string, archivedBy: string): Promise<Stream | null> {
    return withTransaction(this.pool, async (client) => {
      const stream = await StreamRepository.update(client, streamId, { archivedAt: new Date() })
      if (stream) {
        // Emit stream_archived event to the timeline
        const evtId = eventId()
        await StreamEventRepository.insert(client, {
          id: evtId,
          streamId: stream.id,
          eventType: "stream_archived",
          payload: {
            archivedAt: stream.archivedAt,
          },
          actorId: archivedBy,
          actorType: "member",
        })

        // Notify real-time subscribers
        await OutboxRepository.insert(client, "stream:archived", {
          workspaceId: stream.workspaceId,
          streamId: stream.id,
          stream,
        })
      }
      return stream
    })
  }

  async unarchiveStream(streamId: string, unarchivedBy: string): Promise<Stream | null> {
    return withTransaction(this.pool, async (client) => {
      const stream = await StreamRepository.update(client, streamId, { archivedAt: null })
      if (stream) {
        // Emit stream_unarchived event to the timeline
        const evtId = eventId()
        await StreamEventRepository.insert(client, {
          id: evtId,
          streamId: stream.id,
          eventType: "stream_unarchived",
          payload: {},
          actorId: unarchivedBy,
          actorType: "member",
        })

        // Notify real-time subscribers
        await OutboxRepository.insert(client, "stream:unarchived", {
          workspaceId: stream.workspaceId,
          streamId: stream.id,
          stream,
        })
      }
      return stream
    })
  }

  async updateStream(
    streamId: string,
    data: { displayName?: string; slug?: string; description?: string; visibility?: Visibility }
  ): Promise<Stream | null> {
    try {
      return await withTransaction(this.pool, async (client) => {
        // Slug uniqueness check (exclude current stream)
        if (data.slug) {
          const current = await StreamRepository.findById(client, streamId)
          if (current && data.slug !== current.slug) {
            const slugExists = await StreamRepository.slugExistsInWorkspace(client, current.workspaceId, data.slug)
            if (slugExists) {
              throw new DuplicateSlugError(data.slug)
            }
          }
        }

        const stream = await StreamRepository.update(client, streamId, data)
        if (stream) {
          await OutboxRepository.insert(client, "stream:updated", {
            workspaceId: stream.workspaceId,
            streamId: stream.id,
            stream,
          })
        }
        return stream
      })
    } catch (error) {
      // DB unique constraint catches races the application check misses
      if (data.slug && isUniqueViolation(error, "streams_workspace_id_slug_key")) {
        throw new DuplicateSlugError(data.slug)
      }
      throw error
    }
  }

  async checkSlugAvailable(workspaceId: string, slug: string, excludeStreamId?: string): Promise<boolean> {
    return withClient(this.pool, async (client) => {
      if (excludeStreamId) {
        const current = await StreamRepository.findById(client, excludeStreamId)
        if (current && current.slug === slug) return false
      }
      return StreamRepository.slugExistsInWorkspace(client, workspaceId, slug)
    })
  }

  async updateDisplayName(
    streamId: string,
    displayName: string,
    markAsGenerated: boolean = false
  ): Promise<Stream | null> {
    return StreamRepository.update(this.pool, streamId, {
      displayName,
      displayNameGeneratedAt: markAsGenerated ? new Date() : undefined,
    })
  }

  async joinPublicChannel(streamId: string, workspaceId: string, memberId: string): Promise<StreamMember> {
    return withTransaction(this.pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)

      if (!stream || stream.workspaceId !== workspaceId) {
        throw new StreamNotFoundError()
      }

      if (stream.type !== StreamTypes.CHANNEL || stream.visibility !== Visibilities.PUBLIC) {
        throw new HttpError("Can only join public channels", { status: 403, code: "NOT_PUBLIC_CHANNEL" })
      }

      const membership = await StreamMemberRepository.insert(client, streamId, memberId)

      const evtId = eventId()
      const event = await StreamEventRepository.insert(client, {
        id: evtId,
        streamId,
        eventType: "member_joined",
        payload: {},
        actorId: memberId,
        actorType: "member",
      })

      await OutboxRepository.insert(client, "stream:member_joined", {
        workspaceId,
        streamId,
        event,
      })

      return membership
    })
  }

  // Member operations
  async addMember(streamId: string, memberId: string, workspaceId: string): Promise<StreamMember> {
    return withTransaction(this.pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        throw new StreamNotFoundError()
      }

      // Verify the target member belongs to this workspace
      const member = await MemberRepository.findById(client, memberId)
      if (!member || member.workspaceId !== workspaceId) {
        throw new HttpError("Member not found in this workspace", { status: 404, code: "MEMBER_NOT_FOUND" })
      }

      // If this is a thread, also add the member to the root stream
      if (stream.rootStreamId) {
        const isRootMember = await StreamMemberRepository.isMember(client, stream.rootStreamId, memberId)
        if (!isRootMember) {
          await StreamMemberRepository.insert(client, stream.rootStreamId, memberId)
        }
      }

      const membership = await StreamMemberRepository.insert(client, streamId, memberId)

      // Initialize last read to latest event so the member doesn't see all history as unread
      const latestEventIds = await StreamEventRepository.getLatestEventIdByStreamBatch(client, [streamId])
      const latestEventId = latestEventIds.get(streamId)
      if (latestEventId) {
        await StreamMemberRepository.update(client, streamId, memberId, { lastReadEventId: latestEventId })
      }

      await OutboxRepository.insert(client, "stream:member_added", {
        workspaceId: stream.workspaceId,
        streamId,
        memberId,
        stream,
      })

      return membership
    })
  }

  async removeMember(streamId: string, memberId: string): Promise<boolean> {
    return withTransaction(this.pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        throw new StreamNotFoundError()
      }

      // Lock member rows and check count atomically to prevent racing removals
      // from leaving a stream with zero members
      const memberCount = await StreamMemberRepository.countByStreamForUpdate(client, streamId)
      if (memberCount <= 1) {
        throw new HttpError("Cannot remove the only member", { status: 400, code: "LAST_MEMBER" })
      }

      const deleted = await StreamMemberRepository.delete(client, streamId, memberId)

      if (deleted) {
        await OutboxRepository.insert(client, "stream:member_removed", {
          workspaceId: stream.workspaceId,
          streamId,
          memberId,
        })
      }

      return deleted
    })
  }

  async getMembers(streamId: string): Promise<StreamMember[]> {
    return StreamMemberRepository.list(this.pool, { streamId })
  }

  async getMembership(streamId: string, memberId: string): Promise<StreamMember | null> {
    return StreamMemberRepository.findByStreamAndMember(this.pool, streamId, memberId)
  }

  async getMembershipsBatch(streamIds: string[], memberId: string): Promise<StreamMember[]> {
    return StreamMemberRepository.findByStreamsAndMember(this.pool, streamIds, memberId)
  }

  // TODO: This is a permission check masquerading as a membership check. "isMember" is
  // misleading because for threads we actually check root stream membership, not direct
  // membership. Should be broken out into a proper authz module (e.g., canParticipate,
  // canRead, canWrite) that encapsulates the permission model cleanly.
  async isMember(streamId: string, memberId: string): Promise<boolean> {
    return withClient(this.pool, async (client) => {
      const directMember = await StreamMemberRepository.isMember(client, streamId, memberId)
      if (directMember) {
        return true
      }

      // Threads inherit participation rights from root stream
      const stream = await StreamRepository.findById(client, streamId)
      if (stream?.rootStreamId) {
        return StreamMemberRepository.isMember(client, stream.rootStreamId, memberId)
      }

      return false
    })
  }

  async pinStream(streamId: string, memberId: string, pinned: boolean): Promise<StreamMember | null> {
    return withTransaction(this.pool, (client) => StreamMemberRepository.update(client, streamId, memberId, { pinned }))
  }

  async setNotificationLevel(
    streamId: string,
    memberId: string,
    level: NotificationLevel | null
  ): Promise<StreamMember | null> {
    return withTransaction(this.pool, async (client) => {
      if (level !== null) {
        const stream = await StreamRepository.findById(client, streamId)
        if (!stream) throw new StreamNotFoundError()
        if (!isAllowedLevel(stream.type, level)) {
          throw new HttpError(`Notification level '${level}' is not allowed for ${stream.type} streams`, {
            status: 400,
            code: "INVALID_NOTIFICATION_LEVEL",
          })
        }
      }
      return StreamMemberRepository.update(client, streamId, memberId, { notificationLevel: level })
    })
  }

  async markAsRead(
    workspaceId: string,
    streamId: string,
    memberId: string,
    eventId: string
  ): Promise<StreamMember | null> {
    return withTransaction(this.pool, async (client) => {
      const membership = await StreamMemberRepository.update(client, streamId, memberId, { lastReadEventId: eventId })
      if (membership) {
        await OutboxRepository.insert(client, "stream:read", {
          workspaceId,
          authorId: memberId,
          streamId,
          lastReadEventId: eventId,
        })
      }
      return membership
    })
  }

  async markAllAsRead(workspaceId: string, memberId: string): Promise<string[]> {
    return withTransaction(this.pool, async (client) => {
      // Get all memberships for this member in this workspace
      const memberships = await StreamMemberRepository.list(client, { memberId })

      // Get all streams in this workspace to filter memberships
      const streams = await StreamRepository.list(client, workspaceId)
      const workspaceStreamIds = new Set(streams.map((s) => s.id))

      // Filter to only memberships in this workspace
      const workspaceMemberships = memberships.filter((m) => workspaceStreamIds.has(m.streamId))
      if (workspaceMemberships.length === 0) return []

      const streamIds = workspaceMemberships.map((m) => m.streamId)

      // Get latest event ID for each stream
      const latestEventIds = await StreamEventRepository.getLatestEventIdByStreamBatch(client, streamIds)

      // Build batch update map for streams that need updating
      const updatesToApply = new Map<string, string>()
      for (const [streamId, latestEventId] of latestEventIds.entries()) {
        const membership = workspaceMemberships.find((m) => m.streamId === streamId)
        if (membership && membership.lastReadEventId !== latestEventId) {
          updatesToApply.set(streamId, latestEventId)
        }
      }

      // Batch update all memberships in a single query
      if (updatesToApply.size > 0) {
        await StreamMemberRepository.batchUpdateLastReadEventId(client, memberId, updatesToApply)
      }

      const updatedStreamIds = Array.from(updatesToApply.keys())

      if (updatedStreamIds.length > 0) {
        await OutboxRepository.insert(client, "stream:read_all", {
          workspaceId,
          authorId: memberId,
          streamIds: updatedStreamIds,
        })
      }

      return updatedStreamIds
    })
  }

  async getUnreadCounts(
    memberships: Array<{ streamId: string; lastReadEventId: string | null }>
  ): Promise<Map<string, number>> {
    return StreamEventRepository.countUnreadByStreamBatch(this.pool, memberships)
  }

  /**
   * Get a map of messageId -> threadStreamId for all messages in a stream that have threads
   */
  async getThreadsForMessages(streamId: string): Promise<Map<string, string>> {
    return StreamRepository.findThreadsForMessages(this.pool, streamId)
  }

  /**
   * Get a map of messageId -> { threadId, replyCount } for all messages in a stream that have threads.
   * This is an optimized version that fetches threads and counts in a single query.
   */
  async getThreadsWithReplyCounts(streamId: string): Promise<Map<string, { threadId: string; replyCount: number }>> {
    return StreamRepository.findThreadsWithReplyCounts(this.pool, streamId)
  }
}
