import { Pool } from "pg"
import { withClient, withTransaction } from "../db"
import { StreamRepository, Stream, StreamType, CompanionMode } from "../repositories/stream-repository"
import { StreamMemberRepository, StreamMember } from "../repositories/stream-member-repository"
import { streamId } from "../lib/id"
import { DuplicateSlugError, StreamNotFoundError } from "../lib/errors"

export interface CreateScratchpadParams {
  workspaceId: string
  description?: string
  createdBy: string
  companionMode?: CompanionMode
  companionPersonaId?: string
}

export interface CreateChannelParams {
  workspaceId: string
  slug: string
  description?: string
  visibility?: "public" | "private"
  createdBy: string
}

export interface CreateThreadParams {
  workspaceId: string
  parentStreamId: string
  parentMessageId: string
  createdBy: string
}

export interface CreateStreamParams {
  workspaceId: string
  type: StreamType
  slug?: string
  description?: string
  visibility?: "public" | "private"
  companionMode?: CompanionMode
  companionPersonaId?: string
  createdBy: string
}

export class StreamService {
  constructor(private pool: Pool) {}

  async getStreamById(id: string): Promise<Stream | null> {
    return withClient(this.pool, (client) => StreamRepository.findById(client, id))
  }

  async validateStreamAccess(
    streamId: string,
    workspaceId: string,
    userId: string,
  ): Promise<Stream> {
    return withClient(this.pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)

      if (!stream || stream.workspaceId !== workspaceId) {
        throw new StreamNotFoundError()
      }

      if (stream.visibility !== "public") {
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
        types: ["scratchpad"],
      })
      return streams.filter((s) => streamIds.includes(s.id))
    })
  }

  async getStreamsByWorkspace(workspaceId: string): Promise<Stream[]> {
    return withClient(this.pool, (client) =>
      StreamRepository.list(client, workspaceId),
    )
  }

  async list(
    workspaceId: string,
    userId: string,
    filters?: { types?: StreamType[] },
  ): Promise<Stream[]> {
    return withClient(this.pool, async (client) => {
      const memberships = await StreamMemberRepository.list(client, { userId })
      const memberStreamIds = new Set(memberships.map((m) => m.streamId))

      const streams = await StreamRepository.list(client, workspaceId, {
        types: filters?.types,
      })

      // Return public streams OR streams user is member of
      return streams.filter(
        (s) => s.visibility === "public" || memberStreamIds.has(s.id),
      )
    })
  }

  async create(params: CreateStreamParams): Promise<Stream> {
    switch (params.type) {
      case "scratchpad":
        return this.createScratchpad({
          workspaceId: params.workspaceId,
          description: params.description,
          companionMode: params.companionMode,
          companionPersonaId: params.companionPersonaId,
          createdBy: params.createdBy,
        })
      case "channel":
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
        type: "scratchpad",
        // displayName starts NULL, will be auto-generated from conversation
        description: params.description,
        visibility: "private",
        companionMode: params.companionMode ?? "off",
        companionPersonaId: params.companionPersonaId,
        createdBy: params.createdBy,
      })

      // Add creator as member
      await StreamMemberRepository.insert(client, id, params.createdBy)

      return stream
    })
  }

  async createChannel(params: CreateChannelParams): Promise<Stream> {
    return withTransaction(this.pool, async (client) => {
      const id = streamId()

      // Check if slug already exists
      const slugExists = await StreamRepository.slugExistsInWorkspace(
        client,
        params.workspaceId,
        params.slug,
      )
      if (slugExists) {
        throw new DuplicateSlugError(params.slug)
      }

      const stream = await StreamRepository.insert(client, {
        id,
        workspaceId: params.workspaceId,
        type: "channel",
        // Channels use slug as display name, no separate displayName field
        slug: params.slug,
        description: params.description,
        visibility: params.visibility ?? "private",
        createdBy: params.createdBy,
      })

      // Add creator as member
      await StreamMemberRepository.insert(client, id, params.createdBy)

      return stream
    })
  }

  async createThread(params: CreateThreadParams): Promise<Stream> {
    return withTransaction(this.pool, async (client) => {
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
        type: "thread",
        parentStreamId: params.parentStreamId,
        parentMessageId: params.parentMessageId,
        rootStreamId,
        visibility: "private",
        createdBy: params.createdBy,
      })

      // Add creator as member
      await StreamMemberRepository.insert(client, id, params.createdBy)

      return stream
    })
  }

  async updateCompanionMode(
    streamId: string,
    companionMode: CompanionMode,
    companionPersonaId?: string | null,
  ): Promise<Stream | null> {
    return withTransaction(this.pool, (client) =>
      StreamRepository.update(client, streamId, {
        companionMode,
        companionPersonaId,
      }),
    )
  }

  async archiveStream(streamId: string): Promise<Stream | null> {
    return withTransaction(this.pool, (client) =>
      StreamRepository.update(client, streamId, { archivedAt: new Date() }),
    )
  }

  async updateDisplayName(
    streamId: string,
    displayName: string,
    markAsGenerated: boolean = false,
  ): Promise<Stream | null> {
    return withTransaction(this.pool, (client) =>
      StreamRepository.update(client, streamId, {
        displayName,
        displayNameGeneratedAt: markAsGenerated ? new Date() : undefined,
      }),
    )
  }

  // Member operations
  async addMember(streamId: string, userId: string): Promise<StreamMember> {
    return withTransaction(this.pool, (client) =>
      StreamMemberRepository.insert(client, streamId, userId),
    )
  }

  async removeMember(streamId: string, userId: string): Promise<boolean> {
    return withTransaction(this.pool, (client) =>
      StreamMemberRepository.delete(client, streamId, userId),
    )
  }

  async getMembers(streamId: string): Promise<StreamMember[]> {
    return withClient(this.pool, (client) =>
      StreamMemberRepository.list(client, { streamId }),
    )
  }

  async getMembership(streamId: string, userId: string): Promise<StreamMember | null> {
    return withClient(this.pool, (client) =>
      StreamMemberRepository.findByStreamAndUser(client, streamId, userId),
    )
  }

  async isMember(streamId: string, userId: string): Promise<boolean> {
    return withClient(this.pool, (client) =>
      StreamMemberRepository.isMember(client, streamId, userId),
    )
  }

  async pinStream(streamId: string, userId: string, pinned: boolean): Promise<StreamMember | null> {
    return withTransaction(this.pool, (client) =>
      StreamMemberRepository.update(client, streamId, userId, { pinned }),
    )
  }

  async muteStream(streamId: string, userId: string, muted: boolean): Promise<StreamMember | null> {
    return withTransaction(this.pool, (client) =>
      StreamMemberRepository.update(client, streamId, userId, { muted }),
    )
  }

  async markAsRead(streamId: string, userId: string, eventId: string): Promise<StreamMember | null> {
    return withTransaction(this.pool, (client) =>
      StreamMemberRepository.update(client, streamId, userId, { lastReadEventId: eventId }),
    )
  }
}
