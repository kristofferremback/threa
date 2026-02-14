import type { Pool } from "pg"
import { OutboxRepository } from "../../lib/outbox"
import { parseMessageCreatedPayload } from "../../lib/outbox"
import { AuthorTypes } from "@threa/types"
import { logger } from "../../lib/logger"
import { CursorLock, ensureListenerFromLatest, type ProcessResult } from "../../lib/cursor-lock"
import { DebounceWithMaxWait } from "../../lib/debounce"
import type { OutboxHandler } from "../../lib/outbox"
import type { ActivityService } from "./service"
import { withTransaction } from "../../db"

const DEFAULT_CONFIG = {
  batchSize: 100,
  debounceMs: 50,
  maxWaitMs: 200,
  lockDurationMs: 10_000,
  refreshIntervalMs: 5_000,
  maxRetries: 5,
  baseBackoffMs: 1_000,
}

/**
 * Processes message:created events to detect @mentions and create activity items.
 * For each created activity, publishes an activity:created outbox event for real-time delivery.
 */
export class ActivityFeedHandler implements OutboxHandler {
  readonly listenerId = "activity-feed"

  private readonly db: Pool
  private readonly activityService: ActivityService
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, activityService: ActivityService) {
    this.db = db
    this.activityService = activityService
    this.batchSize = DEFAULT_CONFIG.batchSize

    this.cursorLock = new CursorLock({
      pool: db,
      listenerId: this.listenerId,
      lockDurationMs: DEFAULT_CONFIG.lockDurationMs,
      refreshIntervalMs: DEFAULT_CONFIG.refreshIntervalMs,
      maxRetries: DEFAULT_CONFIG.maxRetries,
      baseBackoffMs: DEFAULT_CONFIG.baseBackoffMs,
      batchSize: this.batchSize,
    })

    this.debouncer = new DebounceWithMaxWait(
      () => this.processEvents(),
      DEFAULT_CONFIG.debounceMs,
      DEFAULT_CONFIG.maxWaitMs,
      (err) => logger.error({ err, listenerId: this.listenerId }, "ActivityFeedHandler debouncer error")
    )
  }

  async ensureListener(): Promise<void> {
    await ensureListenerFromLatest(this.db, this.listenerId)
  }

  handle(): void {
    this.debouncer.trigger()
  }

  private async processEvents(): Promise<void> {
    await this.cursorLock.run(async (cursor): Promise<ProcessResult> => {
      const events = await OutboxRepository.fetchAfterId(this.db, cursor, this.batchSize)

      if (events.length === 0) {
        return { status: "no_events" }
      }

      let lastProcessedId = cursor

      try {
        for (const event of events) {
          if (event.eventType !== "message:created") {
            lastProcessedId = event.id
            continue
          }

          const payload = parseMessageCreatedPayload(event.payload)
          if (!payload) {
            logger.debug({ eventId: event.id.toString() }, "ActivityFeedHandler: malformed event, skipping")
            lastProcessedId = event.id
            continue
          }

          const { streamId, workspaceId, event: messageEvent } = payload

          // Only process messages from human members (avoid persona/system loops)
          if (messageEvent.actorType !== AuthorTypes.MEMBER) {
            lastProcessedId = event.id
            continue
          }

          if (!messageEvent.actorId) {
            lastProcessedId = event.id
            continue
          }

          // 1. Mentions first (higher priority notification reason)
          const mentionActivities = await this.activityService.processMessageMentions({
            workspaceId,
            streamId,
            messageId: messageEvent.payload.messageId,
            actorId: messageEvent.actorId,
            contentMarkdown: messageEvent.payload.contentMarkdown,
          })
          const mentionedMemberIds = new Set(mentionActivities.map((a) => a.memberId))

          // 2. Notification-level activities, excluding already-mentioned members
          const notificationActivities = await this.activityService.processMessageNotifications({
            workspaceId,
            streamId,
            messageId: messageEvent.payload.messageId,
            actorId: messageEvent.actorId,
            contentMarkdown: messageEvent.payload.contentMarkdown,
            excludeMemberIds: mentionedMemberIds,
          })

          const activities = [...mentionActivities, ...notificationActivities]

          // Publish all activity:created outbox events in a single transaction
          if (activities.length > 0) {
            await withTransaction(this.db, async (client) => {
              for (const activity of activities) {
                await OutboxRepository.insert(client, "activity:created", {
                  workspaceId,
                  targetMemberId: activity.memberId,
                  activity: {
                    id: activity.id,
                    activityType: activity.activityType,
                    streamId: activity.streamId,
                    messageId: activity.messageId,
                    actorId: activity.actorId,
                    context: activity.context,
                    createdAt: activity.createdAt.toISOString(),
                  },
                })
              }
            })
          }

          lastProcessedId = event.id
        }

        return { status: "processed", newCursor: events[events.length - 1].id }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))

        if (lastProcessedId > cursor) {
          return { status: "error", error, newCursor: lastProcessedId }
        }

        return { status: "error", error }
      }
    })
  }
}
