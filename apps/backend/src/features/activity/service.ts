import type { Pool } from "pg"
import { ActivityRepository, type Activity } from "./repository"
import { MemberRepository } from "../workspaces"
import { extractMentionSlugs } from "../agents/mention-extractor"
import type { StreamService } from "../streams"
import { logger } from "../../lib/logger"

interface ActivityServiceDeps {
  pool: Pool
  streamService: StreamService
}

export class ActivityService {
  private readonly pool: Pool
  private readonly streamService: StreamService

  constructor(deps: ActivityServiceDeps) {
    this.pool = deps.pool
    this.streamService = deps.streamService
  }

  async processMessageMentions(params: {
    workspaceId: string
    streamId: string
    messageId: string
    actorId: string
    contentMarkdown: string
  }): Promise<Activity[]> {
    const { workspaceId, streamId, messageId, actorId, contentMarkdown } = params

    const mentionSlugs = extractMentionSlugs(contentMarkdown)
    if (mentionSlugs.length === 0) return []

    const activities: Activity[] = []

    for (const slug of mentionSlugs) {
      const member = await MemberRepository.findBySlug(this.pool, workspaceId, slug)

      // Skip non-members (could be a persona slug)
      if (!member) continue

      // Skip self-mentions
      if (member.id === actorId) continue

      // Skip if target can't access the stream
      const hasAccess = await this.streamService.hasAccess(streamId, workspaceId, member.id)
      if (!hasAccess) continue

      const activity = await ActivityRepository.insert(this.pool, {
        workspaceId,
        memberId: member.id,
        activityType: "mention",
        streamId,
        messageId,
        actorId,
        context: {
          contentPreview: contentMarkdown.slice(0, 200),
        },
      })

      // null means dedup (ON CONFLICT DO NOTHING) — already tracked
      if (activity) {
        activities.push(activity)
      }
    }

    return activities
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
