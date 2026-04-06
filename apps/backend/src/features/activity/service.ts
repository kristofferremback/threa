import type { Pool, PoolClient } from "pg"
import { ActivityRepository, type Activity } from "./repository"
import { UserRepository } from "../workspaces"
import { StreamRepository, StreamMemberRepository, resolveNotificationLevelsForStream, type Stream } from "../streams"
import { extractMentionSlugs, PersonaRepository } from "../agents"
import { BotRepository } from "../public-api"
import { Visibilities, NotificationLevels, StreamTypes, AuthorTypes, isBroadcastSlug } from "@threa/types"
import { withClient } from "../../db"
import { logger } from "../../lib/logger"

interface ActivityServiceDeps {
  pool: Pool
}

export class ActivityService {
  private readonly pool: Pool

  constructor(deps: ActivityServiceDeps) {
    this.pool = deps.pool
  }

  async processMessageMentions(params: {
    workspaceId: string
    streamId: string
    messageId: string
    actorId: string
    actorType: string
    contentMarkdown: string
  }): Promise<Activity[]> {
    const { workspaceId, streamId, messageId, actorId, actorType, contentMarkdown } = params

    const mentionSlugs = extractMentionSlugs(contentMarkdown)
    if (mentionSlugs.length === 0) return []

    // Partition into broadcast (@channel, @here) and user slugs
    const broadcastSlugs = mentionSlugs.filter(isBroadcastSlug)
    const userSlugs = mentionSlugs.filter((s) => !isBroadcastSlug(s))

    return withClient(this.pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream || stream.workspaceId !== workspaceId) return []

      // Fetch root stream once — reused by access checks, broadcast resolution, and context
      const rootStream = stream.rootStreamId ? await StreamRepository.findById(client, stream.rootStreamId) : null

      // Resolve the effective stream type for broadcast validation:
      // threads inherit their root stream's type for @channel/@here eligibility
      const effectiveType = rootStream?.type ?? stream.type

      // 1. Resolve direct @user mentions
      const userIds = new Set<string>()
      if (userSlugs.length > 0) {
        const users = await UserRepository.findBySlugs(client, workspaceId, userSlugs)
        const candidates = users.filter((u) => u.id !== actorId)
        if (candidates.length > 0) {
          const eligible = await this.filterByAccess(
            client,
            stream,
            rootStream,
            candidates.map((u) => u.id)
          )
          for (const u of candidates) {
            if (eligible.has(u.id)) userIds.add(u.id)
          }
        }
      }

      // 2. Resolve broadcast mentions to member lists
      if (broadcastSlugs.length > 0) {
        const broadcastUserIds = await this.resolveBroadcastTargets(
          client,
          broadcastSlugs,
          stream,
          rootStream,
          effectiveType
        )
        for (const id of broadcastUserIds) {
          userIds.add(id)
        }
      }

      // Exclude the actor
      userIds.delete(actorId)
      if (userIds.size === 0) return []

      const streamContext = resolveStreamContext(stream, rootStream)
      const contentPreview = contentMarkdown.slice(0, 200)
      const authorName = await this.resolveAuthorName(client, workspaceId, actorId, actorType)

      return ActivityRepository.insertBatch(client, {
        workspaceId,
        userIds: [...userIds],
        activityType: "mention",
        streamId,
        messageId,
        actorId,
        actorType,
        context: { contentPreview, authorName, ...streamContext },
      })
    })
  }

  /**
   * Resolve broadcast mention slugs (@channel, @here) to target user IDs.
   *
   * @channel — notifies all members of the root channel (or the channel itself if not in a thread).
   *            Only valid in channel-tree streams.
   * @here    — notifies direct members of the current stream.
   *            Valid in channel-tree and DM-tree streams.
   */
  private async resolveBroadcastTargets(
    client: PoolClient,
    broadcastSlugs: string[],
    stream: Stream,
    rootStream: Stream | null,
    effectiveType: string
  ): Promise<Set<string>> {
    const targetIds = new Set<string>()
    const memberCache = new Map<string, { memberId: string }[]>()

    const getMembers = async (streamId: string) => {
      if (!memberCache.has(streamId)) {
        memberCache.set(streamId, await StreamMemberRepository.list(client, { streamId }))
      }
      return memberCache.get(streamId)!
    }

    for (const slug of broadcastSlugs) {
      if (slug === "channel") {
        // @channel only valid in channel-tree streams
        if (effectiveType !== StreamTypes.CHANNEL) continue

        // Target: all members of the root channel (walk up from thread if needed)
        const channelId = rootStream?.id ?? stream.id
        const members = await getMembers(channelId)
        for (const m of members) targetIds.add(m.memberId)
      } else if (slug === "here") {
        // @here valid in channel-tree and DM-tree streams
        if (effectiveType !== StreamTypes.CHANNEL && effectiveType !== StreamTypes.DM) continue

        // Target: direct members of the current stream
        const members = await getMembers(stream.id)
        for (const m of members) targetIds.add(m.memberId)
      }
    }

    return targetIds
  }

  async processMessageNotifications(params: {
    workspaceId: string
    streamId: string
    messageId: string
    actorId: string
    actorType: string
    contentMarkdown: string
    excludeUserIds: Set<string>
  }): Promise<Activity[]> {
    const { workspaceId, streamId, messageId, actorId, actorType, contentMarkdown, excludeUserIds } = params

    return withClient(this.pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream || stream.workspaceId !== workspaceId) return []

      const streamMembers = await StreamMemberRepository.list(client, { streamId })
      if (streamMembers.length === 0) return []

      // DMs and scratchpads are direct communication — create activities for all
      // non-muted members (more permissive than channels which require ACTIVITY/EVERYTHING).
      const isDirectStream = stream.type === StreamTypes.DM || stream.type === StreamTypes.SCRATCHPAD

      // Fetch root stream once for context
      const rootStream = stream.rootStreamId ? await StreamRepository.findById(client, stream.rootStreamId) : null

      const streamContext = resolveStreamContext(stream, rootStream)
      const contentPreview = contentMarkdown.slice(0, 200)
      const authorName = await this.resolveAuthorName(client, workspaceId, actorId, actorType)

      const resolved = await resolveNotificationLevelsForStream(client, stream, streamMembers)
      const eligibleUserIds = resolved
        .filter((row) => {
          if (row.memberId === actorId) return false
          if (excludeUserIds.has(row.memberId)) return false
          if (isDirectStream) {
            return row.effectiveLevel !== NotificationLevels.MUTED
          }
          return (
            row.effectiveLevel === NotificationLevels.ACTIVITY || row.effectiveLevel === NotificationLevels.EVERYTHING
          )
        })
        .map((row) => row.memberId)

      return ActivityRepository.insertBatch(client, {
        workspaceId,
        userIds: eligibleUserIds,
        activityType: "message",
        streamId,
        messageId,
        actorId,
        actorType,
        context: { contentPreview, authorName, ...streamContext },
      })
    })
  }

  /**
   * Batch-check which user IDs have access to a stream.
   * Public streams: all pass. Private: single batch membership query.
   */
  private async filterByAccess(
    client: PoolClient,
    stream: Stream,
    rootStream: Stream | null,
    userIds: string[]
  ): Promise<Set<string>> {
    if (stream.rootStreamId) {
      if (!rootStream) return new Set()
      if (rootStream.visibility === Visibilities.PUBLIC) return new Set(userIds)
      return StreamMemberRepository.filterMemberIds(client, rootStream.id, userIds)
    }

    if (stream.visibility === Visibilities.PUBLIC) return new Set(userIds)
    return StreamMemberRepository.filterMemberIds(client, stream.id, userIds)
  }

  private async resolveAuthorName(
    client: PoolClient,
    workspaceId: string,
    actorId: string,
    actorType: string
  ): Promise<string | null> {
    switch (actorType) {
      case AuthorTypes.USER: {
        const user = await UserRepository.findById(client, workspaceId, actorId)
        return user?.name ?? null
      }
      case AuthorTypes.BOT: {
        const bot = await BotRepository.findById(client, actorId)
        return bot?.name ?? null
      }
      case AuthorTypes.PERSONA: {
        const persona = await PersonaRepository.findById(client, actorId)
        return persona?.name ?? null
      }
      case AuthorTypes.SYSTEM:
        return "Threa"
      default:
        return null
    }
  }

  async listFeed(
    userId: string,
    workspaceId: string,
    opts?: { limit?: number; cursor?: string; unreadOnly?: boolean }
  ) {
    return ActivityRepository.listByUser(this.pool, userId, workspaceId, opts)
  }

  async getUnreadCounts(
    userId: string,
    workspaceId: string
  ): Promise<{ mentionsByStream: Map<string, number>; totalByStream: Map<string, number>; total: number }> {
    return ActivityRepository.countUnreadGrouped(this.pool, userId, workspaceId)
  }

  async markAsRead(activityId: string, userId: string): Promise<void> {
    await ActivityRepository.markAsRead(this.pool, activityId, userId)
  }

  async markStreamActivityAsRead(userId: string, streamId: string): Promise<void> {
    const count = await ActivityRepository.markStreamAsRead(this.pool, userId, streamId)
    if (count > 0) {
      logger.debug({ userId, streamId, count }, "Marked stream activity as read")
    }
  }

  async markAllAsRead(userId: string, workspaceId: string): Promise<void> {
    const count = await ActivityRepository.markAllAsRead(this.pool, userId, workspaceId)
    if (count > 0) {
      logger.debug({ userId, workspaceId, count }, "Marked all activity as read")
    }
  }
}

function resolveStreamName(stream: Stream): string | null {
  if (stream.type === StreamTypes.CHANNEL && stream.slug) return `#${stream.slug}`
  return stream.displayName ?? null
}

interface StreamContext {
  streamName: string | null
  rootStreamId?: string
  parentStreamName?: string | null
}

function resolveStreamContext(stream: Stream, rootStream: Stream | null): StreamContext {
  if (!stream.rootStreamId) return { streamName: resolveStreamName(stream) }

  return {
    streamName: resolveStreamName(stream),
    rootStreamId: stream.rootStreamId,
    parentStreamName: rootStream ? resolveStreamName(rootStream) : undefined,
  }
}
