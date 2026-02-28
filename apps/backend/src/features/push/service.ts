import type { Pool } from "pg"
import webpush from "web-push"
import { withTransaction } from "../../db"
import { PushSubscriptionRepository, type PushSubscription, type InsertPushSubscriptionParams } from "./repository"
import { UserSessionRepository, type UserSession } from "./session-repository"
import {
  PrefNotificationLevels,
  ActivityTypes,
  StreamTypes,
  type PrefNotificationLevel,
  type StreamType,
} from "@threa/types"
import { logger } from "../../lib/logger"
import type { ActivityCreatedOutboxPayload } from "../../lib/outbox"

/** Session is "active" if heartbeat within this window (2x the 30s heartbeat interval) */
const ACTIVE_SESSION_WINDOW_MS = 60_000

/** Maximum push subscriptions per user per workspace to bound parallel delivery calls */
const MAX_SUBSCRIPTIONS_PER_USER = 10

/** Callbacks for resolving cross-feature data (INV-52: access via service layer, not repos) */
interface CrossFeatureLookups {
  /** Resolve a user's notification level preference. */
  getUserNotificationLevel: (workspaceId: string, userId: string) => Promise<PrefNotificationLevel>
  /** Resolve a stream's type by ID within a workspace. Returns null if not found. */
  getStreamType: (workspaceId: string, streamId: string) => Promise<StreamType | null>
}

interface PushServiceDeps {
  pool: Pool
  vapidConfig: {
    publicKey: string
    privateKey: string
    subject: string
  } | null
  lookups: CrossFeatureLookups
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
  private readonly lookups: CrossFeatureLookups

  constructor(deps: PushServiceDeps) {
    this.pool = deps.pool
    this.lookups = deps.lookups

    if (deps.vapidConfig) {
      // INV-9 approved exception: web-push requires module-level VAPID config (same class as
      // Langfuse/OTEL — external library bootstrap constraint). Only one PushService per process.
      webpush.setVapidDetails(deps.vapidConfig.subject, deps.vapidConfig.publicKey, deps.vapidConfig.privateKey)
      this.vapidPublicKey = deps.vapidConfig.publicKey
      this.canSend = true
    } else {
      this.vapidPublicKey = ""
      this.canSend = false
    }
  }

  isEnabled(): boolean {
    return this.canSend
  }

  getVapidPublicKey(): string {
    return this.vapidPublicKey
  }

  async subscribe(params: InsertPushSubscriptionParams): Promise<PushSubscription> {
    // Atomic cap enforcement (INV-20): count + evict + insert in one transaction.
    // The FOR UPDATE lock serializes concurrent subscribe calls for the same user.
    // Existence check runs after locking to prevent double-eviction races.
    return withTransaction(this.pool, async (client) => {
      const count = await PushSubscriptionRepository.countByUserForUpdate(client, params.workspaceId, params.userId)
      if (count >= MAX_SUBSCRIPTIONS_PER_USER) {
        const isReRegister = await PushSubscriptionRepository.existsByEndpoint(
          client,
          params.workspaceId,
          params.userId,
          params.endpoint
        )
        if (!isReRegister) {
          await PushSubscriptionRepository.deleteOldestByUser(client, params.workspaceId, params.userId)
        }
      }
      return PushSubscriptionRepository.insert(client, params)
    })
  }

  async unsubscribe(workspaceId: string, userId: string, endpoint: string): Promise<boolean> {
    return PushSubscriptionRepository.deleteByEndpoint(this.pool, workspaceId, userId, endpoint)
  }

  async upsertSession(params: { workspaceId: string; userId: string; deviceKey: string }): Promise<UserSession> {
    return UserSessionRepository.upsert(this.pool, params)
  }

  async upsertSessionsBatch(entries: Array<{ workspaceId: string; userId: string; deviceKey: string }>): Promise<void> {
    return UserSessionRepository.upsertBatch(this.pool, entries)
  }

  /**
   * Delete user sessions that haven't sent a heartbeat within the retention window.
   * Cross-workspace by design (INV-8 infra exception): user_sessions is ephemeral
   * delivery-infrastructure data (heartbeat timestamps for push suppression), not
   * user-facing product data. Scoping cleanup per-workspace would require iterating
   * all workspaces for a simple time-based GC — same pattern as orphan session cleanup.
   */
  async cleanupStaleSessions(olderThanMs: number): Promise<number> {
    return UserSessionRepository.cleanupStale(this.pool, olderThanMs)
  }

  /**
   * Core delivery method: evaluates an activity:created event and sends push
   * notifications to the target user's eligible devices.
   *
   * Sends structured data in the push payload (INV-46); the service worker
   * formats display text client-side.
   */
  async deliverPushForActivity(payload: ActivityCreatedOutboxPayload): Promise<void> {
    if (!this.canSend) return

    const { workspaceId, targetUserId, activity } = payload

    // 1. Load user's global notification preference (via injected lookup)
    const prefLevel = await this.lookups.getUserNotificationLevel(workspaceId, targetUserId)

    // 2. Filter by preference
    if (prefLevel === PrefNotificationLevels.NONE) {
      return
    }

    if (prefLevel === PrefNotificationLevels.MENTIONS) {
      const shouldPush = await this.shouldPushForMentionsMode(workspaceId, activity.activityType, activity.streamId)
      if (!shouldPush) {
        return
      }
    }

    // 3. Determine which subscriptions to push to based on active sessions
    const subscriptions = await this.getTargetSubscriptions(workspaceId, targetUserId)
    if (subscriptions.length === 0) {
      return
    }

    // 4. Build structured push payload — display text is formatted by the service worker (INV-46)
    const context = activity.context as { contentPreview?: string; streamName?: string } | null | undefined
    const pushPayload = JSON.stringify({
      data: {
        workspaceId,
        streamId: activity.streamId,
        messageId: activity.messageId,
        activityType: activity.activityType,
        contentPreview: context?.contentPreview?.slice(0, 200),
        streamName: context?.streamName,
      },
    })

    // 5. Send to all target subscriptions
    const staleIds: string[] = []
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
            logger.info({ subscriptionId: sub.id, statusCode }, "Marking stale push subscription for removal")
            staleIds.push(sub.id)
          } else {
            logger.warn({ err, subscriptionId: sub.id }, "Failed to send push notification")
          }
        }
      })
    )

    // 6. Batch-delete stale subscriptions (INV-56)
    if (staleIds.length > 0) {
      try {
        await PushSubscriptionRepository.deleteByIds(this.pool, workspaceId, staleIds)
      } catch (deleteErr) {
        logger.warn({ err: deleteErr, count: staleIds.length }, "Failed to delete stale subscriptions")
      }
    }
  }

  /**
   * For "mentions" mode: push if activityType is "mention", or if the message
   * is from a DM or scratchpad (direct communication channels).
   */
  private async shouldPushForMentionsMode(
    workspaceId: string,
    activityType: string,
    streamId: string
  ): Promise<boolean> {
    if (activityType === ActivityTypes.MENTION) {
      return true
    }

    if (activityType === ActivityTypes.MESSAGE) {
      const streamType = await this.lookups.getStreamType(workspaceId, streamId)
      if (streamType === StreamTypes.DM || streamType === StreamTypes.SCRATCHPAD) {
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
}
