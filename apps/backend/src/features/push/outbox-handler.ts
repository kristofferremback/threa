import type { Pool } from "pg"
import webpush from "web-push"
import { OutboxRepository, type ActivityCreatedOutboxPayload } from "../../lib/outbox"
import { PushSubscriptionRepository } from "./repository"
import { UserSessionRepository } from "./session-repository"
import { UserPreferencesRepository } from "../user-preferences"
import { StreamRepository } from "../streams"
import { PrefNotificationLevels, type PrefNotificationLevel } from "@threa/types"
import { logger } from "../../lib/logger"
import { CursorLock, ensureListenerFromLatest, DebounceWithMaxWait, type ProcessResult } from "@threa/backend-common"
import type { OutboxHandler } from "../../lib/outbox"

/** Session is "active" if heartbeat within this window (2x the 30s heartbeat interval) */
const ACTIVE_SESSION_WINDOW_MS = 60_000

const DEFAULT_CONFIG = {
  batchSize: 100,
  debounceMs: 50,
  maxWaitMs: 200,
  lockDurationMs: 10_000,
  refreshIntervalMs: 5_000,
  maxRetries: 5,
  baseBackoffMs: 1_000,
}

interface PushNotificationHandlerDeps {
  pool: Pool
  vapidPublicKey: string
  vapidPrivateKey: string
  vapidSubject: string
}

/**
 * Listens for activity:created outbox events and sends Web Push notifications.
 * Filters by user's global PrefNotificationLevel and suppresses based on active sessions.
 */
export class PushNotificationHandler implements OutboxHandler {
  readonly listenerId = "push-notifications"

  private readonly db: Pool
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(deps: PushNotificationHandlerDeps) {
    this.db = deps.pool
    this.batchSize = DEFAULT_CONFIG.batchSize

    webpush.setVapidDetails(deps.vapidSubject, deps.vapidPublicKey, deps.vapidPrivateKey)

    this.cursorLock = new CursorLock({
      pool: deps.pool,
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
      (err) => logger.error({ err, listenerId: this.listenerId }, "PushNotificationHandler debouncer error")
    )
  }

  async ensureListener(): Promise<void> {
    await ensureListenerFromLatest(this.db, this.listenerId)
  }

  handle(): void {
    this.debouncer.trigger()
  }

  private async processEvents(): Promise<void> {
    await this.cursorLock.run(async (cursor, processedIds): Promise<ProcessResult> => {
      const events = await OutboxRepository.fetchAfterId(this.db, cursor, this.batchSize, processedIds)

      if (events.length === 0) {
        return { status: "no_events" }
      }

      const seen: bigint[] = []

      try {
        for (const event of events) {
          if (event.eventType !== "activity:created") {
            seen.push(event.id)
            continue
          }

          const payload = event.payload as ActivityCreatedOutboxPayload
          await this.handleActivityCreated(payload)
          seen.push(event.id)
        }

        return { status: "processed", processedIds: seen }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        if (seen.length > 0) {
          return { status: "error", error, processedIds: seen }
        }
        return { status: "error", error }
      }
    })
  }

  private async handleActivityCreated(payload: ActivityCreatedOutboxPayload): Promise<void> {
    const { workspaceId, targetUserId, activity } = payload

    // 1. Load user's global notification preference
    const prefLevel = await this.getUserNotificationLevel(targetUserId)

    // 2. Filter by preference
    if (prefLevel === PrefNotificationLevels.NONE) {
      return
    }

    if (prefLevel === PrefNotificationLevels.MENTIONS) {
      const shouldPush = await this.shouldPushForMentionsMode(activity.activityType, activity.streamId)
      if (!shouldPush) {
        return
      }
    }

    // 3. Determine which subscriptions to push to based on active sessions
    const subscriptions = await this.getTargetSubscriptions(workspaceId, targetUserId)
    if (subscriptions.length === 0) {
      return
    }

    // 4. Build push payload
    const pushPayload = JSON.stringify({
      title: this.buildTitle(activity.activityType),
      body: this.buildBody(activity),
      data: {
        workspaceId,
        streamId: activity.streamId,
        messageId: activity.messageId,
        activityType: activity.activityType,
      },
    })

    // 5. Send to all target subscriptions
    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            pushPayload
          )
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode
          if (statusCode === 404 || statusCode === 410) {
            // Subscription expired or unsubscribed — clean up
            logger.info({ subscriptionId: sub.id, statusCode }, "Removing stale push subscription")
            try {
              await PushSubscriptionRepository.deleteById(this.db, workspaceId, sub.id)
            } catch (deleteErr) {
              logger.warn({ err: deleteErr, subscriptionId: sub.id }, "Failed to delete stale subscription")
            }
          } else {
            logger.warn({ err, subscriptionId: sub.id }, "Failed to send push notification")
          }
        }
      })
    )
  }

  private async getUserNotificationLevel(userId: string): Promise<PrefNotificationLevel> {
    const overrides = await UserPreferencesRepository.findOverrides(this.db, userId)
    const notifOverride = overrides.find((o) => o.key === "notificationLevel")
    return (notifOverride?.value as PrefNotificationLevel) ?? "all"
  }

  /**
   * For "mentions" mode: push if activityType is "mention", or if the message
   * is from a DM or scratchpad (direct communication channels).
   */
  private async shouldPushForMentionsMode(activityType: string, streamId: string): Promise<boolean> {
    if (activityType === "mention") {
      return true
    }

    // For "message" activities, check if the stream is a DM or scratchpad
    if (activityType === "message") {
      const stream = await StreamRepository.findById(this.db, streamId)
      if (stream && (stream.type === "dm" || stream.type === "scratchpad")) {
        return true
      }
    }

    return false
  }

  /**
   * Session-aware delivery:
   * - If 1+ sessions are active: suppress push on those devices, push only to offline ones
   * - If 0 sessions are active (user fully offline): push to ALL subscriptions
   */
  private async getTargetSubscriptions(workspaceId: string, userId: string) {
    const allSubscriptions = await PushSubscriptionRepository.findByUserId(this.db, workspaceId, userId)
    if (allSubscriptions.length === 0) return []

    const activeSessions = await UserSessionRepository.getActiveSessions(
      this.db,
      workspaceId,
      userId,
      ACTIVE_SESSION_WINDOW_MS
    )

    if (activeSessions.length > 0) {
      // Suppress push on devices where the user is currently active
      const activeDeviceKeys = new Set(activeSessions.map((s) => s.deviceKey))
      return allSubscriptions.filter((s) => !activeDeviceKeys.has(s.deviceKey))
    }

    // Fully offline — push to all devices
    return allSubscriptions
  }

  private buildTitle(activityType: string): string {
    switch (activityType) {
      case "mention":
        return "You were mentioned"
      case "message":
        return "New message"
      default:
        return "New activity"
    }
  }

  private buildBody(activity: ActivityCreatedOutboxPayload["activity"]): string {
    const context = activity.context as { contentPreview?: string; streamName?: string }
    if (context.contentPreview) {
      return context.contentPreview.slice(0, 200)
    }
    if (context.streamName) {
      return `Activity in ${context.streamName}`
    }
    return "You have new activity in Threa"
  }
}
