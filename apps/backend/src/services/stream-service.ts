import { z } from "zod"
import { Pool } from "pg"
import { withClient, withTransaction } from "../db"
import { StreamRepository, Stream } from "../repositories/stream-repository"
import { StreamMemberRepository, StreamMember } from "../repositories/stream-member-repository"
import { OutboxRepository } from "../repositories/outbox-repository"
import { streamId } from "../lib/id"
import { DuplicateSlugError, StreamNotFoundError } from "../lib/errors"
import { StreamTypes, Visibilities, CompanionModes, type StreamType, type CompanionMode } from "@threa/types"
import { streamTypeSchema, visibilitySchema, companionModeSchema } from "../lib/schemas"

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
    return withClient(this.pool, (client) => StreamRepository.findById(client, id))
  }

  async validateStreamAccess(streamId: string, workspaceId: string, userId: string): Promise<Stream> {
    return withClient(this.pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)

      if (!stream || stream.workspaceId !== workspaceId) {
        throw new StreamNotFoundError()
      }

      // For threads, check access to root stream instead of direct membership
      if (stream.rootStreamId) {
        const rootStream = await StreamRepository.findById(client, stream.rootStreamId)
        if (!rootStream) {
          throw new StreamNotFoundError()
        }

        // Check root stream access: public streams are accessible to all, private require membership
        if (rootStream.visibility !== Visibilities.PUBLIC) {
          const isRootMember = await StreamMemberRepository.isMember(client, stream.rootStreamId, userId)
          if (!isRootMember) {
            throw new StreamNotFoundError()
          }
        }

        return stream
      }

      // Non-thread streams: check direct visibility/membership
      if (stream.visibility !== Visibilities.PUBLIC) {
        const isMember = await StreamMemberRepository.isMember(client, streamId, userId)
        if (!isMember) {
          throw new StreamNotFoundError()
        }
      }

      return stream
    })
  }

  async getScratchpadsByUser(workspaceId: string, userId: string): Promise<Stream[]> {
    return withClient(this.pool, async (client) => {
      const memberships = await StreamMemberRepository.list(client, { userId })
      const streamIds = memberships.map((m) => m.streamId)

      if (streamIds.length === 0) return []

      const streams = await StreamRepository.list(client, workspaceId, {
        types: [StreamTypes.SCRATCHPAD],
      })
      return streams.filter((s) => streamIds.includes(s.id))
    })
  }

  async getStreamsByWorkspace(workspaceId: string): Promise<Stream[]> {
    return withClient(this.pool, (client) => StreamRepository.list(client, workspaceId))
  }

  async list(workspaceId: string, userId: string, filters?: { types?: StreamType[] }): Promise<Stream[]> {
    return withClient(this.pool, async (client) => {
      const memberships = await StreamMemberRepository.list(client, { userId })
      const memberStreamIds = memberships.map((m) => m.streamId)

      return StreamRepository.list(client, workspaceId, {
        types: filters?.types,
        userMembershipStreamIds: memberStreamIds,
      })
    })
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
        visibility: params.visibility ?? Visibilities.PRIVATE,
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
      // Check if thread already exists for this parent message (find-or-create)
      const existing = await StreamRepository.findByParentMessage(client, params.parentStreamId, params.parentMessageId)
      if (existing) {
        // Just add user as member if not already
        const isMember = await StreamMemberRepository.isMember(client, existing.id, params.createdBy)
        if (!isMember) {
          await StreamMemberRepository.insert(client, existing.id, params.createdBy)
        }
        return existing
      }

      // Get parent stream to determine root
      const parentStream = await StreamRepository.findById(client, params.parentStreamId)
      if (!parentStream) {
        throw new Error("Parent stream not found")
      }

      // Root is either the parent's root (if parent is a thread) or the parent itself
      const rootStreamId = parentStream.rootStreamId ?? parentStream.id

      const id = streamId()

      const stream = await StreamRepository.insert(client, {
        id,
        workspaceId: params.workspaceId,
        type: StreamTypes.THREAD,
        parentStreamId: params.parentStreamId,
        parentMessageId: params.parentMessageId,
        rootStreamId,
        visibility: Visibilities.PRIVATE,
        createdBy: params.createdBy,
      })

      // Add creator as member
      await StreamMemberRepository.insert(client, id, params.createdBy)

      // Broadcast stream:created to PARENT stream's room (not the new thread's room)
      // This lets watchers of the parent see the thread indicator appear
      await OutboxRepository.insert(client, "stream:created", {
        workspaceId: params.workspaceId,
        streamId: params.parentStreamId,
        stream,
      })

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

  async archiveStream(streamId: string): Promise<Stream | null> {
    return withTransaction(this.pool, async (client) => {
      const stream = await StreamRepository.update(client, streamId, { archivedAt: new Date() })
      if (stream) {
        await OutboxRepository.insert(client, "stream:archived", {
          workspaceId: stream.workspaceId,
          streamId: stream.id,
          stream,
        })
      }
      return stream
    })
  }

  async updateStream(streamId: string, data: { displayName?: string; description?: string }): Promise<Stream | null> {
    return withTransaction(this.pool, async (client) => {
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
  }

  async updateDisplayName(
    streamId: string,
    displayName: string,
    markAsGenerated: boolean = false
  ): Promise<Stream | null> {
    return withTransaction(this.pool, (client) =>
      StreamRepository.update(client, streamId, {
        displayName,
        displayNameGeneratedAt: markAsGenerated ? new Date() : undefined,
      })
    )
  }

  // Member operations
  async addMember(streamId: string, userId: string): Promise<StreamMember> {
    return withTransaction(this.pool, async (client) => {
      // Get the stream to check if it has a root (is a thread)
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        throw new StreamNotFoundError()
      }

      // If this is a thread, also add the user to the root stream
      if (stream.rootStreamId) {
        const isRootMember = await StreamMemberRepository.isMember(client, stream.rootStreamId, userId)
        if (!isRootMember) {
          await StreamMemberRepository.insert(client, stream.rootStreamId, userId)
        }
      }

      return StreamMemberRepository.insert(client, streamId, userId)
    })
  }

  async removeMember(streamId: string, userId: string): Promise<boolean> {
    return withTransaction(this.pool, (client) => StreamMemberRepository.delete(client, streamId, userId))
  }

  async getMembers(streamId: string): Promise<StreamMember[]> {
    return withClient(this.pool, (client) => StreamMemberRepository.list(client, { streamId }))
  }

  async getMembership(streamId: string, userId: string): Promise<StreamMember | null> {
    return withClient(this.pool, (client) => StreamMemberRepository.findByStreamAndUser(client, streamId, userId))
  }

  async getMembershipsBatch(streamIds: string[], userId: string): Promise<StreamMember[]> {
    return withClient(this.pool, (client) => StreamMemberRepository.findByStreamsAndUser(client, streamIds, userId))
  }

  async isMember(streamId: string, userId: string): Promise<boolean> {
    return withClient(this.pool, (client) => StreamMemberRepository.isMember(client, streamId, userId))
  }

  async pinStream(streamId: string, userId: string, pinned: boolean): Promise<StreamMember | null> {
    return withTransaction(this.pool, (client) => StreamMemberRepository.update(client, streamId, userId, { pinned }))
  }

  async muteStream(streamId: string, userId: string, muted: boolean): Promise<StreamMember | null> {
    return withTransaction(this.pool, (client) => StreamMemberRepository.update(client, streamId, userId, { muted }))
  }

  async markAsRead(streamId: string, userId: string, eventId: string): Promise<StreamMember | null> {
    return withTransaction(this.pool, (client) =>
      StreamMemberRepository.update(client, streamId, userId, { lastReadEventId: eventId })
    )
  }

  /**
   * Get a map of messageId -> threadStreamId for all messages in a stream that have threads
   */
  async getThreadsForMessages(streamId: string): Promise<Map<string, string>> {
    return withClient(this.pool, (client) => StreamRepository.findThreadsForMessages(client, streamId))
  }
}
