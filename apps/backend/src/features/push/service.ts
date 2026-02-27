import type { Pool } from "pg"
import webpush from "web-push"
import { PushSubscriptionRepository, type PushSubscription, type InsertPushSubscriptionParams } from "./repository"
import { UserSessionRepository, type UserSession } from "./session-repository"
import { UserPreferencesRepository } from "../user-preferences"
import { StreamRepository } from "../streams"
import { PrefNotificationLevels, ActivityTypes, StreamTypes, type PrefNotificationLevel } from "@threa/types"
import { logger } from "../../lib/logger"
import type { ActivityCreatedOutboxPayload } from "../../lib/outbox"

/** Session is "active" if heartbeat within this window (2x the 30s heartbeat interval) */
const ACTIVE_SESSION_WINDOW_MS = 60_000

interface PushServiceDeps {
  pool: Pool
  vapidConfig: {
    publicKey: string
    privateKey: string
    subject: string
  } | null
}

/**
 * Manages push subscriptions, session tracking, and push delivery.
 *
 * The VAPID config is optional — when null, delivery methods are no-ops
 * (push feature is disabled but the service can still be constructed).
 */
export class PushService {
  private readonly pool: Pool
  private readonly vapidPublicKey: string
  private readonly canSend: boolean

  constructor(deps: PushServiceDeps) {
    this.pool = deps.pool

    if (deps.vapidConfig) {
      // Module-level side-effect — only one PushService instance is created per process (INV-9 acknowledged)
      webpush.setVapidDetails(deps.vapidConfig.subject, deps.vapidConfig.publicKey, deps.vapidConfig.privateKey)
      this.vapidPublicKey = deps.vapidConfig.publicKey
      this.canSend = true
    } else {
      this.vapidPublicKey = ""
      this.canSend = false
    }
  }

  getVapidPublicKey(): string {
    return this.vapidPublicKey
  }

  async subscribe(params: InsertPushSubscriptionParams): Promise<PushSubscription> {
    return PushSubscriptionRepository.insert(this.pool, params)
  }

  async unsubscribe(workspaceId: string, userId: string, endpoint: string): Promise<boolean> {
    return PushSubscriptionRepository.deleteByEndpoint(this.pool, workspaceId, userId, endpoint)
  }

  async upsertSession(params: { workspaceId: string; userId: string; deviceKey: string }): Promise<UserSession> {
    return UserSessionRepository.upsert(this.pool, params)
  }

  async getActiveSessions(workspaceId: string, userId: string, windowMs: number): Promise<UserSession[]> {
    return UserSessionRepository.getActiveSessions(this.pool, workspaceId, userId, windowMs)
  }

  /**
   * Core delivery method: evaluates an activity:created event and sends push
   * notifications to the target user's eligible devices.
   */
  async deliverPushForActivity(payload: ActivityCreatedOutboxPayload): Promise<void> {
    if (!this.canSend) return

    const { workspaceId, targetUserId, activity } = payload

    // 1. Load user's global notification preference
    // Cross-feature repo access: user_preference_overrides is keyed by userId (workspace-scoped)
    // so no additional workspace filter is needed.
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
            logger.info({ subscriptionId: sub.id, statusCode }, "Removing stale push subscription")
            try {
              await PushSubscriptionRepository.deleteById(this.pool, workspaceId, sub.id)
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
    const overrides = await UserPreferencesRepository.findOverrides(this.pool, userId)
    const notifOverride = overrides.find((o) => o.key === "notificationLevel")
    const value = notifOverride?.value
    if (
      value === PrefNotificationLevels.ALL ||
      value === PrefNotificationLevels.MENTIONS ||
      value === PrefNotificationLevels.NONE
    ) {
      return value
    }
    return PrefNotificationLevels.ALL
  }

  /**
   * For "mentions" mode: push if activityType is "mention", or if the message
   * is from a DM or scratchpad (direct communication channels).
   */
  private async shouldPushForMentionsMode(activityType: string, streamId: string): Promise<boolean> {
    if (activityType === ActivityTypes.MENTION) {
      return true
    }

    if (activityType === ActivityTypes.MESSAGE) {
      const stream = await StreamRepository.findById(this.pool, streamId)
      if (stream && (stream.type === StreamTypes.DM || stream.type === StreamTypes.SCRATCHPAD)) {
        return true
      }
    }

    return false
  }

  /**
   * Session-aware delivery:
   * - If 1+ sessions are active: suppress push on those devices, push only to offline ones
   * - If 0 sessions are active (user fully offline): push to ALL subscriptions
   *
   * Note: device keys are derived from User-Agent hashes. Two browser instances with
   * identical UAs share a device key — when either is active, both are considered active.
   * This is acceptable since same-UA instances are typically on the same physical device.
   */
  private async getTargetSubscriptions(workspaceId: string, userId: string) {
    const allSubscriptions = await PushSubscriptionRepository.findByUserId(this.pool, workspaceId, userId)
    if (allSubscriptions.length === 0) return []

    const activeSessions = await UserSessionRepository.getActiveSessions(
      this.pool,
      workspaceId,
      userId,
      ACTIVE_SESSION_WINDOW_MS
    )

    if (activeSessions.length > 0) {
      const activeDeviceKeys = new Set(activeSessions.map((s) => s.deviceKey))
      return allSubscriptions.filter((s) => !activeDeviceKeys.has(s.deviceKey))
    }

    return allSubscriptions
  }

  private buildTitle(activityType: string): string {
    switch (activityType) {
      case ActivityTypes.MENTION:
        return "You were mentioned"
      case ActivityTypes.MESSAGE:
        return "New message"
      default:
        return "New activity"
    }
  }

  private buildBody(activity: ActivityCreatedOutboxPayload["activity"]): string {
    const context = activity.context as { contentPreview?: string; streamName?: string } | null | undefined
    if (context?.contentPreview) {
      return context.contentPreview.slice(0, 200)
    }
    if (context?.streamName) {
      return `Activity in ${context.streamName}`
    }
    return "You have new activity in Threa"
  }
}
