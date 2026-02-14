import type { Pool, PoolClient } from "pg"
import { ActivityRepository, type Activity } from "./repository"
import { MemberRepository } from "../workspaces"
import { StreamRepository, StreamMemberRepository, type Stream } from "../streams"
import { resolveNotificationLevelsForStream } from "../streams/notification-resolver"
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

    // Single connection: resolve slugs, check stream access, insert activities
    return withClient(this.pool, async (client) => {
      const members = await MemberRepository.findBySlugs(client, workspaceId, mentionSlugs)

      const candidates = members.filter((m) => m.id !== actorId)
      if (candidates.length === 0) return []

      // Fetch stream once to determine access rules
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream || stream.workspaceId !== workspaceId) return []

      const eligible = await this.filterByAccess(
        client,
        stream,
        candidates.map((m) => m.id)
      )
      if (eligible.size === 0) return []

      const streamContext = await resolveStreamContext(client, stream)
      const contentPreview = contentMarkdown.slice(0, 200)
      const activities: Activity[] = []

      for (const member of candidates) {
        if (!eligible.has(member.id)) continue
        const activity = await ActivityRepository.insert(client, {
          workspaceId,
          memberId: member.id,
          activityType: "mention",
          streamId,
          messageId,
          actorId,
          actorType,
          context: { contentPreview, ...streamContext },
        })
        // null means dedup (ON CONFLICT DO NOTHING) — already tracked
        if (activity) {
          activities.push(activity)
        }
      }

      return activities
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

      const streamContext = await resolveStreamContext(client, stream)
      const contentPreview = contentMarkdown.slice(0, 200)
      const activities: Activity[] = []

      for (const resolution of resolved) {
        // Skip the actor (don't notify yourself)
        if (resolution.memberId === actorId) continue
        // Skip members who already got a mention activity
        if (excludeMemberIds.has(resolution.memberId)) continue

        // Only activity or everything levels trigger message notifications
        if (
          resolution.effectiveLevel !== NotificationLevels.ACTIVITY &&
          resolution.effectiveLevel !== NotificationLevels.EVERYTHING
        ) {
          continue
        }

        const activity = await ActivityRepository.insert(client, {
          workspaceId,
          memberId: resolution.memberId,
          activityType: "message",
          streamId,
          messageId,
          actorId,
          actorType,
          context: { contentPreview, ...streamContext },
        })
        if (activity) {
          activities.push(activity)
        }
      }

      return activities
    })
  }

  /**
   * Batch-check which memberIds have access to a stream.
   * Public streams: all pass. Private: single batch membership query.
   */
  private async filterByAccess(client: PoolClient, stream: Stream, memberIds: string[]): Promise<Set<string>> {
    if (stream.rootStreamId) {
      // Thread: access derived from root stream
      const rootStream = await StreamRepository.findById(client, stream.rootStreamId)
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
  ): Promise<{ byStream: Map<string, number>; total: number }> {
    const [byStream, total] = await Promise.all([
      ActivityRepository.countUnreadByStream(this.pool, memberId, workspaceId),
      ActivityRepository.countUnread(this.pool, memberId, workspaceId),
    ])
    return { byStream, total }
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

function resolveStreamName(stream: Stream): string {
  if (stream.type === StreamTypes.CHANNEL && stream.slug) return `#${stream.slug}`
  return stream.displayName || "Untitled"
}

interface StreamContext {
  streamName: string
  rootStreamId?: string
  parentStreamName?: string
}

async function resolveStreamContext(client: PoolClient, stream: Stream): Promise<StreamContext> {
  if (!stream.rootStreamId) return { streamName: resolveStreamName(stream) }

  // For threads, the parent/root stream name is the stable reference —
  // thread names are often assigned asynchronously and may not exist yet.
  // Also store rootStreamId so the frontend can resolve from bootstrap
  // even for old activity items without parentStreamName.
  const rootStream = await StreamRepository.findById(client, stream.rootStreamId)
  return {
    streamName: resolveStreamName(stream),
    rootStreamId: stream.rootStreamId,
    parentStreamName: rootStream ? resolveStreamName(rootStream) : undefined,
  }
}
