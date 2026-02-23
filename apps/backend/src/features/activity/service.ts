import type { Pool, PoolClient } from "pg"
import { ActivityRepository, type Activity } from "./repository"
import { UserRepository } from "../workspaces"
import { StreamRepository, StreamMemberRepository, resolveNotificationLevelsForStream, type Stream } from "../streams"
import { extractMentionSlugs } from "../agents"
import { Visibilities, NotificationLevels, StreamTypes } from "@threa/types"
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

    return withClient(this.pool, async (client) => {
      const users = await UserRepository.findBySlugs(client, workspaceId, mentionSlugs)

      const candidates = users.filter((u) => u.id !== actorId)
      if (candidates.length === 0) return []

      const stream = await StreamRepository.findById(client, streamId)
      if (!stream || stream.workspaceId !== workspaceId) return []

      // Fetch root stream once — reused by both access check and context
      const rootStream = stream.rootStreamId ? await StreamRepository.findById(client, stream.rootStreamId) : null

      const eligible = await this.filterByAccess(
        client,
        stream,
        rootStream,
        candidates.map((m) => m.id)
      )
      if (eligible.size === 0) return []

      const streamContext = resolveStreamContext(stream, rootStream)
      const contentPreview = contentMarkdown.slice(0, 200)
      const eligibleUserIds = candidates.filter((u) => eligible.has(u.id)).map((u) => u.id)

      return ActivityRepository.insertBatch(client, {
        workspaceId,
        userIds: eligibleUserIds,
        activityType: "mention",
        streamId,
        messageId,
        actorId,
        actorType,
        context: { contentPreview, ...streamContext },
      })
    })
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

      // Resolve effective notification levels for all members
      const resolved = await resolveNotificationLevelsForStream(client, stream, streamMembers)

      // Fetch root stream once for context
      const rootStream = stream.rootStreamId ? await StreamRepository.findById(client, stream.rootStreamId) : null

      const streamContext = resolveStreamContext(stream, rootStream)
      const contentPreview = contentMarkdown.slice(0, 200)
      const resolvedUsers = resolved.map((row) => ({ userId: row.memberId, effectiveLevel: row.effectiveLevel }))

      const eligibleUserIds = resolvedUsers
        .filter((row) => {
          if (row.userId === actorId) return false
          if (excludeUserIds.has(row.userId)) return false
          return (
            row.effectiveLevel === NotificationLevels.ACTIVITY || row.effectiveLevel === NotificationLevels.EVERYTHING
          )
        })
        .map((row) => row.userId)

      return ActivityRepository.insertBatch(client, {
        workspaceId,
        userIds: eligibleUserIds,
        activityType: "message",
        streamId,
        messageId,
        actorId,
        actorType,
        context: { contentPreview, ...streamContext },
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
