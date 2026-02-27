import { describe, test, expect, beforeAll, afterAll, beforeEach, spyOn } from "bun:test"
import type { Pool } from "pg"
import webpush from "web-push"
import { PushSubscriptionRepository, PushService, UserSessionRepository } from "../../src/features/push"
import { workspaceId, userId, streamId, messageId, activityId } from "../../src/lib/id"
import { setupTestDatabase } from "./setup"
import {
  PrefNotificationLevels,
  ActivityTypes,
  StreamTypes,
  type PrefNotificationLevel,
  type StreamType,
} from "@threa/types"
import type { ActivityCreatedOutboxPayload } from "../../src/lib/outbox"

// Stub web-push to avoid real HTTP calls
const sendSpy = spyOn(webpush, "sendNotification").mockResolvedValue({} as any)

describe("Push Notifications", () => {
  let pool: Pool
  let testWorkspaceId: string
  let testUserId: string

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM push_subscriptions")
    await pool.query("DELETE FROM user_sessions")
    testWorkspaceId = workspaceId()
    testUserId = userId()
    sendSpy.mockReset()
    sendSpy.mockResolvedValue({} as any)
  })

  describe("PushSubscriptionRepository", () => {
    test("insert creates subscription with correct fields", async () => {
      const sub = await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/1",
        p256dh: "test-p256dh-key",
        auth: "test-auth-key",
        deviceKey: "device-abc",
        userAgent: "TestBrowser/1.0",
      })

      expect(sub).toMatchObject({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/1",
        p256dh: "test-p256dh-key",
        auth: "test-auth-key",
        deviceKey: "device-abc",
        userAgent: "TestBrowser/1.0",
      })
      expect(sub.id).toStartWith("push_sub_")
      expect(sub.createdAt).toBeInstanceOf(Date)
      expect(sub.updatedAt).toBeInstanceOf(Date)
    })

    test("insert upserts keys when same (workspace, user, endpoint)", async () => {
      const params = {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/upsert",
        p256dh: "original-p256dh",
        auth: "original-auth",
        deviceKey: "device-xyz",
      }

      const first = await PushSubscriptionRepository.insert(pool, params)

      const second = await PushSubscriptionRepository.insert(pool, {
        ...params,
        p256dh: "updated-p256dh",
        auth: "updated-auth",
      })

      // Same subscription row, not a new one
      expect(second.id).toBe(first.id)
      expect(second.p256dh).toBe("updated-p256dh")
      expect(second.auth).toBe("updated-auth")

      // Verify only one row exists
      const all = await PushSubscriptionRepository.findByUserId(pool, testWorkspaceId, testUserId)
      expect(all).toHaveLength(1)
    })

    test("deleteByEndpoint removes subscription and returns true; false for non-existent", async () => {
      await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/to-delete",
        p256dh: "p",
        auth: "a",
        deviceKey: "d",
      })

      const deleted = await PushSubscriptionRepository.deleteByEndpoint(
        pool,
        testWorkspaceId,
        testUserId,
        "https://push.example.com/sub/to-delete"
      )
      expect(deleted).toBe(true)

      const notFound = await PushSubscriptionRepository.deleteByEndpoint(
        pool,
        testWorkspaceId,
        testUserId,
        "https://push.example.com/sub/nonexistent"
      )
      expect(notFound).toBe(false)
    })

    test("deleteByIds batch removes subscriptions; no-op for empty array", async () => {
      const sub1 = await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/batch-1",
        p256dh: "p1",
        auth: "a1",
        deviceKey: "d1",
      })
      const sub2 = await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/batch-2",
        p256dh: "p2",
        auth: "a2",
        deviceKey: "d2",
      })

      // No-op for empty array
      await PushSubscriptionRepository.deleteByIds(pool, testWorkspaceId, [])
      let remaining = await PushSubscriptionRepository.findByUserId(pool, testWorkspaceId, testUserId)
      expect(remaining).toHaveLength(2)

      // Delete both
      await PushSubscriptionRepository.deleteByIds(pool, testWorkspaceId, [sub1.id, sub2.id])
      remaining = await PushSubscriptionRepository.findByUserId(pool, testWorkspaceId, testUserId)
      expect(remaining).toHaveLength(0)
    })

    test("findByUserId returns all subs for user; empty for no subs", async () => {
      const otherUserId = userId()

      // No subs yet
      const empty = await PushSubscriptionRepository.findByUserId(pool, testWorkspaceId, testUserId)
      expect(empty).toHaveLength(0)

      // Add two subs for testUserId
      await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/find-1",
        p256dh: "p1",
        auth: "a1",
        deviceKey: "d1",
      })
      await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/find-2",
        p256dh: "p2",
        auth: "a2",
        deviceKey: "d2",
      })

      const subs = await PushSubscriptionRepository.findByUserId(pool, testWorkspaceId, testUserId)
      expect(subs).toHaveLength(2)

      // Other user has no subs
      const otherSubs = await PushSubscriptionRepository.findByUserId(pool, testWorkspaceId, otherUserId)
      expect(otherSubs).toHaveLength(0)
    })
  })

  describe("UserSessionRepository", () => {
    test("upsert creates session with correct fields", async () => {
      const session = await UserSessionRepository.upsert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        deviceKey: "device-session-1",
      })

      expect(session).toMatchObject({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        deviceKey: "device-session-1",
      })
      expect(session.id).toStartWith("usess_")
      expect(session.lastActiveAt).toBeInstanceOf(Date)
      expect(session.createdAt).toBeInstanceOf(Date)
    })

    test("upsert updates lastActiveAt on conflict", async () => {
      const first = await UserSessionRepository.upsert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        deviceKey: "device-session-2",
      })

      // Small delay to ensure timestamps differ
      await new Promise((r) => setTimeout(r, 50))

      const second = await UserSessionRepository.upsert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        deviceKey: "device-session-2",
      })

      expect(second.id).toBe(first.id)
      expect(second.lastActiveAt.getTime()).toBeGreaterThanOrEqual(first.lastActiveAt.getTime())
    })

    test("getActiveSessions returns sessions within window, excludes stale ones", async () => {
      // Create an active session (just upserted = now)
      await UserSessionRepository.upsert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        deviceKey: "active-device",
      })

      // Create a stale session by manually backdating last_active_at
      const staleSession = await UserSessionRepository.upsert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        deviceKey: "stale-device",
      })
      await pool.query(`UPDATE user_sessions SET last_active_at = now() - interval '5 minutes' WHERE id = $1`, [
        staleSession.id,
      ])

      // 60_000ms window should only return the active session
      const active = await UserSessionRepository.getActiveSessions(pool, testWorkspaceId, testUserId, 60_000)

      expect(active).toHaveLength(1)
      expect(active[0].deviceKey).toBe("active-device")
    })

    test("cleanupStale deletes sessions older than threshold, returns count", async () => {
      // Create two sessions
      const s1 = await UserSessionRepository.upsert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        deviceKey: "cleanup-1",
      })
      const s2 = await UserSessionRepository.upsert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        deviceKey: "cleanup-2",
      })

      // Backdate both to be stale
      await pool.query(`UPDATE user_sessions SET last_active_at = now() - interval '2 hours' WHERE id = ANY($1)`, [
        [s1.id, s2.id],
      ])

      // Create a fresh session that should survive cleanup
      await UserSessionRepository.upsert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        deviceKey: "cleanup-fresh",
      })

      // Cleanup sessions older than 1 hour (3_600_000 ms)
      const deletedCount = await UserSessionRepository.cleanupStale(pool, 3_600_000)
      expect(deletedCount).toBe(2)

      // Fresh session should still exist
      const remaining = await UserSessionRepository.getActiveSessions(pool, testWorkspaceId, testUserId, 60_000)
      expect(remaining).toHaveLength(1)
      expect(remaining[0].deviceKey).toBe("cleanup-fresh")
    })
  })

  describe("PushService.deliverPushForActivity", () => {
    function makePayload(overrides?: Partial<ActivityCreatedOutboxPayload>): ActivityCreatedOutboxPayload {
      return {
        workspaceId: testWorkspaceId,
        targetUserId: testUserId,
        activity: {
          id: activityId(),
          activityType: ActivityTypes.MENTION,
          streamId: streamId(),
          messageId: messageId(),
          actorId: userId(),
          actorType: "user",
          context: { contentPreview: "Hello", streamName: "general" },
          createdAt: new Date().toISOString(),
        },
        ...overrides,
      }
    }

    function createServiceWithLookups(overrides?: {
      notificationLevel?: PrefNotificationLevel
      streamType?: StreamType | null
    }) {
      return new PushService({
        pool,
        vapidConfig: {
          publicKey: "BM1RQ2UEVpAlbEgYOQ3bDrGAOrJGBmmh4_4UkmtGRzhi-5WPFmPuJbA6zv4kCp0iycvTaH6eveCXedCE0xSnZbk",
          privateKey: "eHUfakWGHrS4ft0HiSGyhTOBCQJ9VAKWl4XK53qsjMg",
          subject: "mailto:test@threa.app",
        },
        lookups: {
          getUserNotificationLevel: async () => overrides?.notificationLevel ?? PrefNotificationLevels.ALL,
          getStreamType: async () => overrides?.streamType ?? StreamTypes.CHANNEL,
        },
      })
    }

    test("pref=none skips push", async () => {
      const service = createServiceWithLookups({ notificationLevel: PrefNotificationLevels.NONE })

      // Create a subscription so we can verify it's NOT called
      await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/pref-none",
        p256dh: "p",
        auth: "a",
        deviceKey: "d",
      })

      await service.deliverPushForActivity(makePayload())
      expect(sendSpy).not.toHaveBeenCalled()
    })

    test("pref=mentions, activityType=message in channel skips", async () => {
      const service = createServiceWithLookups({
        notificationLevel: PrefNotificationLevels.MENTIONS,
        streamType: StreamTypes.CHANNEL,
      })

      await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/mentions-channel",
        p256dh: "p",
        auth: "a",
        deviceKey: "d",
      })

      await service.deliverPushForActivity(
        makePayload({
          activity: {
            ...makePayload().activity,
            activityType: ActivityTypes.MESSAGE,
          },
        })
      )

      expect(sendSpy).not.toHaveBeenCalled()
    })

    test("pref=mentions, activityType=mention pushes", async () => {
      const service = createServiceWithLookups({
        notificationLevel: PrefNotificationLevels.MENTIONS,
      })

      await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/mentions-mention",
        p256dh: "p",
        auth: "a",
        deviceKey: "d",
      })

      await service.deliverPushForActivity(
        makePayload({
          activity: {
            ...makePayload().activity,
            activityType: ActivityTypes.MENTION,
          },
        })
      )

      expect(sendSpy).toHaveBeenCalledTimes(1)
    })

    test("pref=mentions, activityType=message in DM pushes", async () => {
      const service = createServiceWithLookups({
        notificationLevel: PrefNotificationLevels.MENTIONS,
        streamType: StreamTypes.DM,
      })

      await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/mentions-dm",
        p256dh: "p",
        auth: "a",
        deviceKey: "d",
      })

      await service.deliverPushForActivity(
        makePayload({
          activity: {
            ...makePayload().activity,
            activityType: ActivityTypes.MESSAGE,
          },
        })
      )

      expect(sendSpy).toHaveBeenCalledTimes(1)
    })

    test("pref=all pushes for any activity", async () => {
      const service = createServiceWithLookups({
        notificationLevel: PrefNotificationLevels.ALL,
      })

      await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/all-activity",
        p256dh: "p",
        auth: "a",
        deviceKey: "d",
      })

      await service.deliverPushForActivity(
        makePayload({
          activity: {
            ...makePayload().activity,
            activityType: ActivityTypes.MESSAGE,
          },
        })
      )

      expect(sendSpy).toHaveBeenCalledTimes(1)
    })

    test("session-aware: user active on device skips that device", async () => {
      const service = createServiceWithLookups()

      // Two subscriptions on different devices
      await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/active-device",
        p256dh: "p1",
        auth: "a1",
        deviceKey: "device-active",
      })
      await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/offline-device",
        p256dh: "p2",
        auth: "a2",
        deviceKey: "device-offline",
      })

      // Mark device-active as having an active session
      await UserSessionRepository.upsert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        deviceKey: "device-active",
      })

      await service.deliverPushForActivity(makePayload())

      // Should only push to the offline device
      expect(sendSpy).toHaveBeenCalledTimes(1)
      const calledEndpoint = sendSpy.mock.calls[0][0]
      expect(calledEndpoint).toMatchObject({
        endpoint: "https://push.example.com/sub/offline-device",
      })
    })

    test("session-aware: user fully offline pushes to all devices", async () => {
      const service = createServiceWithLookups()

      await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/offline-1",
        p256dh: "p1",
        auth: "a1",
        deviceKey: "device-1",
      })
      await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/offline-2",
        p256dh: "p2",
        auth: "a2",
        deviceKey: "device-2",
      })

      // No active sessions — user is fully offline
      await service.deliverPushForActivity(makePayload())

      expect(sendSpy).toHaveBeenCalledTimes(2)
    })

    test("stale subscription cleanup on 410 response", async () => {
      const service = createServiceWithLookups()

      const staleSub = await PushSubscriptionRepository.insert(pool, {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        endpoint: "https://push.example.com/sub/stale-410",
        p256dh: "p",
        auth: "a",
        deviceKey: "d",
      })

      // Simulate 410 Gone from push service
      sendSpy.mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }))

      await service.deliverPushForActivity(makePayload())

      // The stale subscription should be deleted
      const remaining = await PushSubscriptionRepository.findByUserId(pool, testWorkspaceId, testUserId)
      expect(remaining).toHaveLength(0)
    })
  })
})
