import type { Pool } from "pg"
import webpush from "web-push"
import { withTransaction, withClient } from "../../db"
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
import type { ActivityCreatedOutboxPayload, SavedReminderFiredOutboxPayload } from "../../lib/outbox"

/** Maximum push subscriptions per user per workspace to bound parallel delivery calls */
const MAX_SUBSCRIPTIONS_PER_USER = 10

/** How recently a device must have sent a heartbeat to be considered "active" */
const ACTIVE_SESSION_WINDOW_MS = 60_000

/** How recently a device must have been focused to consider the user "at their computer" */
const RECENTLY_FOCUSED_WINDOW_MS = 10 * 60 * 1_000 // 10 minutes

/**
 * Per-device session expiry window. If a specific device has not sent a heartbeat
 * within this window, its auth session has likely expired. We send a "session expired"
 * push to that device and clean up its subscription individually — other devices with
 * active sessions are unaffected. Matches the 30-day session cookie TTL and the
 * session GC window in session-cleanup.ts.
 */
const SESSION_EXPIRY_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000 // 30 days (matches cookie TTL)

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

  /** Remove all push subscriptions for a browser endpoint across all workspaces (used on logout). */
  async unsubscribeAllWorkspaces(endpoint: string, workosUserId: string): Promise<number> {
    return PushSubscriptionRepository.deleteByEndpointForUser(this.pool, endpoint, workosUserId)
  }

  async upsertSession(params: {
    workspaceId: string
    userId: string
    deviceKey: string
    focused?: boolean
  }): Promise<UserSession> {
    return UserSessionRepository.upsert(this.pool, params)
  }

  async upsertSessionsBatch(
    entries: Array<{ workspaceId: string; userId: string; deviceKey: string }>,
    focused?: boolean
  ): Promise<void> {
    return UserSessionRepository.upsertBatch(this.pool, entries, focused)
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

    // Self rows represent the target user's own action — do not push.
    if (activity.isSelf) return

    // Member-added activities notify via the feed only, not push.
    if (activity.activityType === ActivityTypes.MEMBER_ADDED) return

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

    // 3. Determine which subscriptions to push to, partitioned by session state.
    // Subscriptions on devices with an expired session get a one-shot "session expired"
    // notification and are cleaned up; active-device subscriptions get normal delivery.
    const { active: activeSubscriptions, expired: expiredSubscriptions } = await this.getTargetSubscriptions(
      workspaceId,
      targetUserId
    )

    // 3b. Handle expired-device subscriptions: notify and clean up per-device
    if (expiredSubscriptions.length > 0) {
      await this.deliverSessionExpiredAndCleanup(workspaceId, targetUserId, expiredSubscriptions)
    }

    if (activeSubscriptions.length === 0) {
      return
    }

    // 4. Build structured push payload — display text is formatted by the service worker (INV-46)
    const context = activity.context as
      | { contentPreview?: string; streamName?: string; authorName?: string }
      | null
      | undefined
    const pushPayload = JSON.stringify({
      data: {
        workspaceId,
        streamId: activity.streamId,
        messageId: activity.messageId,
        activityType: activity.activityType,
        contentPreview: context?.contentPreview?.slice(0, 200),
        streamName: context?.streamName,
        authorName: context?.authorName,
      },
    })

    // 5. Send to active-device subscriptions and evict stale ones
    await this.sendAndEvictStale(workspaceId, activeSubscriptions, pushPayload)
  }

  /**
   * Deliver push for a saved-message reminder. Reminders respect the user's
   * global notification preference — a user with push disabled gets no
   * delivery even for a reminder they explicitly scheduled. (Sonner toast
   * still fires via socket delivery on online devices.)
   */
  async deliverPushForSavedReminder(payload: SavedReminderFiredOutboxPayload): Promise<void> {
    if (!this.canSend) return

    const { workspaceId, targetUserId, savedId, messageId, streamId, saved } = payload

    const prefLevel = await this.lookups.getUserNotificationLevel(workspaceId, targetUserId)
    if (prefLevel === PrefNotificationLevels.NONE) {
      return
    }

    const { active: activeSubscriptions, expired: expiredSubscriptions } = await this.getTargetSubscriptions(
      workspaceId,
      targetUserId
    )

    if (expiredSubscriptions.length > 0) {
      await this.deliverSessionExpiredAndCleanup(workspaceId, targetUserId, expiredSubscriptions)
    }

    if (activeSubscriptions.length === 0) {
      return
    }

    // Structured payload (INV-46): the SW composes display text. When the
    // message is unavailable (deleted or access lost) we still notify — the
    // user set the reminder deliberately — but include the reason so the SW
    // can render "Reminder (message deleted)".
    const pushPayload = JSON.stringify({
      data: {
        kind: "saved_reminder",
        workspaceId,
        savedId,
        streamId,
        messageId,
        streamName: saved.message?.streamName ?? null,
        contentPreview: saved.message?.contentMarkdown?.slice(0, 200) ?? null,
        unavailableReason: saved.unavailableReason ?? null,
      },
    })

    await this.sendAndEvictStale(workspaceId, activeSubscriptions, pushPayload)
  }

  /**
   * For "mentions" mode: push if activityType is "mention", or if the message
   * or reaction is from a DM or scratchpad (direct communication channels).
   *
   * Reactions follow the same semantics as messages (thread-activity tier,
   * not mention tier) — they push in direct channels, not in general channels.
   */
  private async shouldPushForMentionsMode(
    workspaceId: string,
    activityType: string,
    streamId: string
  ): Promise<boolean> {
    if (activityType === ActivityTypes.MENTION) {
      return true
    }

    if (activityType === ActivityTypes.MESSAGE || activityType === ActivityTypes.REACTION) {
      const streamType = await this.lookups.getStreamType(workspaceId, streamId)
      if (streamType === StreamTypes.DM || streamType === StreamTypes.SCRATCHPAD) {
        return true
      }
    }

    return false
  }

  /**
   * Sends a "clear" push to all of a user's devices so the service worker
   * dismisses any notification for the given stream(s). Called when the user
   * reads a stream on one device so other devices clear the notification too.
   */
  async deliverClearForStream(workspaceId: string, userId: string, streamId: string): Promise<void> {
    return this.deliverClearForStreams(workspaceId, userId, [streamId])
  }

  /** Batch variant: clears notifications for multiple streams at once (e.g. mark-all-read). */
  async deliverClearForStreams(workspaceId: string, userId: string, streamIds: string[]): Promise<void> {
    if (!this.canSend || streamIds.length === 0) return

    const subscriptions = await PushSubscriptionRepository.findByUserId(this.pool, workspaceId, userId)
    if (subscriptions.length === 0) return

    // Send one clear push per stream — each stream has its own notification tag in the SW
    await Promise.all(
      streamIds.map((streamId) => {
        const pushPayload = JSON.stringify({ data: { action: "clear", streamId } })
        return this.sendAndEvictStale(workspaceId, subscriptions, pushPayload)
      })
    )
  }

  /**
   * Sends a push payload to the given subscriptions and batch-deletes any
   * that return 404/410 (INV-56). Shared by delivery and clear paths (INV-35).
   */
  private async sendAndEvictStale(
    workspaceId: string,
    subscriptions: PushSubscription[],
    pushPayload: string
  ): Promise<void> {
    const staleIds: string[] = []
    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
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

    if (staleIds.length > 0) {
      try {
        await PushSubscriptionRepository.deleteByIds(this.pool, workspaceId, staleIds)
      } catch (deleteErr) {
        logger.warn({ err: deleteErr, count: staleIds.length }, "Failed to delete stale subscriptions")
      }
    }
  }

  /**
   * Sends a "session expired" push to the given devices and deletes their
   * subscriptions. Only targets devices whose sessions have expired — active
   * devices are unaffected. The SW shows a "Your session has expired — tap
   * to sign back in" notification.
   */
  private async deliverSessionExpiredAndCleanup(
    workspaceId: string,
    userId: string,
    subscriptions: PushSubscription[]
  ): Promise<void> {
    const pushPayload = JSON.stringify({
      data: {
        action: "session_expired" as const,
        workspaceId,
      },
    })

    // Best-effort delivery — some subscriptions may already be stale
    await this.sendAndEvictStale(workspaceId, subscriptions, pushPayload)

    // Clean up remaining subscriptions so no further notifications are sent.
    // Reuse the IDs we already have rather than re-fetching (INV-20: avoids
    // select-then-delete race where a concurrent subscribe could be wiped).
    // deleteByIds is a no-op for IDs already removed by sendAndEvictStale.
    const subscriptionIds = subscriptions.map((s) => s.id)
    try {
      await PushSubscriptionRepository.deleteByIds(this.pool, workspaceId, subscriptionIds)
      logger.info(
        { workspaceId, userId, count: subscriptionIds.length },
        "Cleaned up push subscriptions for expired session"
      )
    } catch (err) {
      logger.warn({ err, workspaceId, userId }, "Failed to clean up push subscriptions for expired session")
    }
  }

  /**
   * Determines which devices should receive a push notification and which
   * have expired sessions that should be cleaned up.
   *
   * Returns `active` (subscriptions to deliver to) and `expired` (subscriptions
   * on devices with no session within SESSION_EXPIRY_WINDOW_MS — these get a
   * session-expired push and are cleaned up).
   *
   * Four-tier strategy for active subscriptions (SW handles focus-based suppression):
   * 1. Threa focused       → push to active device, SW suppresses (user sees nothing)
   * 2. Threa open, unfocused (<10m) → push to active device, SW shows notification
   * 3. Threa open, unfocused 10m+   → push to ALL active devices (user walked away)
   * 4. Offline 60s+                  → push to ALL active devices
   */
  private async getTargetSubscriptions(
    workspaceId: string,
    userId: string
  ): Promise<{ active: PushSubscription[]; expired: PushSubscription[] }> {
    // INV-30: multiple related reads share a client; INV-41: release before network I/O
    const { allSubs, activeSessions, recentDeviceKeys } = await withClient(this.pool, async (client) => {
      const subs = await PushSubscriptionRepository.findByUserId(client, workspaceId, userId)
      if (subs.length === 0)
        return {
          allSubs: subs,
          activeSessions: [] as Awaited<ReturnType<typeof UserSessionRepository.getActiveSessions>>,
          recentDeviceKeys: new Set<string>(),
        }
      const sessions = await UserSessionRepository.getActiveSessions(
        client,
        workspaceId,
        userId,
        ACTIVE_SESSION_WINDOW_MS
      )
      // Check which device keys have had any session activity within the expiry
      // window — cross-workspace, because the auth cookie is global.
      const subDeviceKeys = [...new Set(subs.map((s) => s.deviceKey))]
      const deviceKeys = await UserSessionRepository.getRecentDeviceKeys(
        client,
        subDeviceKeys,
        SESSION_EXPIRY_WINDOW_MS
      )
      return { allSubs: subs, activeSessions: sessions, recentDeviceKeys: deviceKeys }
    })
    if (allSubs.length === 0) return { active: [], expired: [] }

    // Partition subscriptions: devices with no session in the expiry window are expired.
    // Devices that have a recent session (even if not active right now) are still valid.
    const activeSubs: PushSubscription[] = []
    const expiredSubs: PushSubscription[] = []
    for (const sub of allSubs) {
      if (recentDeviceKeys.has(sub.deviceKey)) {
        activeSubs.push(sub)
      } else {
        expiredSubs.push(sub)
      }
    }

    if (activeSubs.length === 0) return { active: [], expired: expiredSubs }

    // Apply four-tier targeting to active subscriptions only
    // Tier 4: No active sessions (within 60s) → user is offline → push to all active devices
    if (activeSessions.length === 0) return { active: activeSubs, expired: expiredSubs }

    // Check if any active session was focused recently (within 10m).
    // If not, the user likely walked away from their computer with Threa open.
    const now = Date.now()
    const hasRecentlyFocused = activeSessions.some(
      (s) => s.lastFocusedAt && now - s.lastFocusedAt.getTime() < RECENTLY_FOCUSED_WINDOW_MS
    )

    // Tier 3: Active sessions but none focused recently → user walked away → push to all active
    if (!hasRecentlyFocused) return { active: activeSubs, expired: expiredSubs }

    // Tiers 1 & 2: User is at their computer → push to devices with active sessions.
    // The SW on each device decides whether to display (focused = suppress).
    // Fall back to all active subscriptions if the intersection is empty — a session can
    // exist on a device without a subscription (e.g. second browser, or subscription
    // registered on a device that no longer has an active socket).
    const activeDeviceKeys = new Set(activeSessions.map((s) => s.deviceKey))
    const matched = activeSubs.filter((sub) => activeDeviceKeys.has(sub.deviceKey))
    const active = matched.length > 0 ? matched : activeSubs
    return { active, expired: expiredSubs }
  }
}
