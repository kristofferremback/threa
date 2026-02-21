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
      const members = await UserRepository.findBySlugs(client, workspaceId, mentionSlugs)

      const candidates = members.filter((m) => m.id !== actorId)
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
      const eligibleMemberIds = candidates.filter((m) => eligible.has(m.id)).map((m) => m.id)

      return ActivityRepository.insertBatch(client, {
        workspaceId,
        memberIds: eligibleMemberIds,
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
    excludeMemberIds: Set<string>
  }): Promise<Activity[]> {
    const { workspaceId, streamId, messageId, actorId, actorType, contentMarkdown, excludeMemberIds } = params

    return withClient(this.pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream || stream.workspaceId !== workspaceId) return []

      const members = await StreamMemberRepository.list(client, { streamId })
      if (members.length === 0) return []

      // Resolve effective notification levels for all members
      const resolved = await resolveNotificationLevelsForStream(client, stream, members)

      // Fetch root stream once for context
      const rootStream = stream.rootStreamId ? await StreamRepository.findById(client, stream.rootStreamId) : null

      const streamContext = resolveStreamContext(stream, rootStream)
      const contentPreview = contentMarkdown.slice(0, 200)

      const eligibleMemberIds = resolved
        .filter((r) => {
          if (r.memberId === actorId) return false
          if (excludeMemberIds.has(r.memberId)) return false
          return r.effectiveLevel === NotificationLevels.ACTIVITY || r.effectiveLevel === NotificationLevels.EVERYTHING
        })
        .map((r) => r.memberId)

      return ActivityRepository.insertBatch(client, {
        workspaceId,
        memberIds: eligibleMemberIds,
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
   * Batch-check which memberIds have access to a stream.
   * Public streams: all pass. Private: single batch membership query.
   */
  private async filterByAccess(
    client: PoolClient,
    stream: Stream,
    rootStream: Stream | null,
    memberIds: string[]
  ): Promise<Set<string>> {
    if (stream.rootStreamId) {
      if (!rootStream) return new Set()
      if (rootStream.visibility === Visibilities.PUBLIC) return new Set(memberIds)
      return StreamMemberRepository.filterMemberIds(client, rootStream.id, memberIds)
    }

    if (stream.visibility === Visibilities.PUBLIC) return new Set(memberIds)
    return StreamMemberRepository.filterMemberIds(client, stream.id, memberIds)
  }

  async listFeed(
    memberId: string,
    workspaceId: string,
    opts?: { limit?: number; cursor?: string; unreadOnly?: boolean }
  ): Promise<Activity[]> {
    return ActivityRepository.listByMember(this.pool, memberId, workspaceId, opts)
  }

  async getUnreadCounts(
    memberId: string,
    workspaceId: string
  ): Promise<{ mentionsByStream: Map<string, number>; totalByStream: Map<string, number>; total: number }> {
    return ActivityRepository.countUnreadGrouped(this.pool, memberId, workspaceId)
  }

  async markAsRead(activityId: string, memberId: string): Promise<void> {
    await ActivityRepository.markAsRead(this.pool, activityId, memberId)
  }

  async markStreamActivityAsRead(memberId: string, streamId: string): Promise<void> {
    const count = await ActivityRepository.markStreamAsRead(this.pool, memberId, streamId)
    if (count > 0) {
      logger.debug({ memberId, streamId, count }, "Marked stream activity as read")
    }
  }

  async markAllAsRead(memberId: string, workspaceId: string): Promise<void> {
    const count = await ActivityRepository.markAllAsRead(this.pool, memberId, workspaceId)
    if (count > 0) {
      logger.debug({ memberId, workspaceId, count }, "Marked all activity as read")
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
