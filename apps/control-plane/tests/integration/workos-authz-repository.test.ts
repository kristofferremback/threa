import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import type { Pool } from "pg"
import { WorkosAuthzRepository } from "../../src/features/workos-authz"
import { setupTestDatabase } from "./setup"

describe("WorkosAuthzRepository", () => {
  let pool: Pool
  const orgId = "org_test_authz_repo"
  const userId = "user_test_authz_repo"
  const otherUserId = "user_test_authz_repo_2"

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM workos_organization_memberships WHERE workos_organization_id = $1", [orgId])
  })

  describe("upsertMembershipFromEvent", () => {
    test("inserts a new membership when none exists", async () => {
      const t0 = new Date("2026-01-01T00:00:00Z")
      const result = await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["member"],
        eventId: "event_01",
        eventCreatedAt: t0,
      })

      expect(result).not.toBeNull()
      expect(result!.workos_organization_id).toBe(orgId)
      expect(result!.workos_user_id).toBe(userId)
      expect(result!.status).toBe("active")
      expect(result!.role_slugs).toEqual(["member"])
      expect(result!.last_event_id).toBe("event_01")
    })

    test("applies an event newer than the persisted state", async () => {
      const t0 = new Date("2026-01-01T00:00:00Z")
      const t1 = new Date("2026-01-01T00:00:01Z")

      await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["member"],
        eventId: "event_01",
        eventCreatedAt: t0,
      })

      const result = await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["admin"],
        eventId: "event_02",
        eventCreatedAt: t1,
      })

      expect(result).not.toBeNull()
      expect(result!.role_slugs).toEqual(["admin"])
      expect(result!.last_event_id).toBe("event_02")
    })

    test("rejects a stale event with last_event_at older than persisted state (INV-20)", async () => {
      const t1 = new Date("2026-01-01T00:00:10Z")
      const t0 = new Date("2026-01-01T00:00:00Z")

      await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["admin"],
        eventId: "event_02",
        eventCreatedAt: t1,
      })

      const stale = await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["member"],
        eventId: "event_01",
        eventCreatedAt: t0,
      })

      expect(stale).toBeNull()

      const persisted = await WorkosAuthzRepository.getByOrgAndUser(pool, orgId, userId)
      expect(persisted!.role_slugs).toEqual(["admin"])
      expect(persisted!.last_event_id).toBe("event_02")
    })

    test("rejects a duplicate event with identical last_event_at", async () => {
      const t = new Date("2026-01-01T00:00:00Z")

      await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["member"],
        eventId: "event_01",
        eventCreatedAt: t,
      })

      const dup = await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["admin"],
        eventId: "event_01_dup",
        eventCreatedAt: t,
      })

      expect(dup).toBeNull()
    })
  })

  describe("upsertMembershipFromBackfill", () => {
    test("inserts a new membership and clears last_event_id", async () => {
      const observedAt = new Date("2026-01-01T00:00:00Z")

      const row = await WorkosAuthzRepository.upsertMembershipFromBackfill(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["member"],
        observedAt,
      })

      expect(row.last_event_id).toBeNull()
      expect(row.role_slugs).toEqual(["member"])
    })

    test("overwrites existing rows unconditionally even if observedAt is older than last_event_at", async () => {
      const tEvent = new Date("2026-02-01T00:00:00Z")
      const tBackfill = new Date("2026-01-01T00:00:00Z") // older than persisted event

      await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["admin"],
        eventId: "event_99",
        eventCreatedAt: tEvent,
      })

      const row = await WorkosAuthzRepository.upsertMembershipFromBackfill(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "inactive",
        roleSlugs: ["member"],
        observedAt: tBackfill,
      })

      expect(row.status).toBe("inactive")
      expect(row.role_slugs).toEqual(["member"])
      expect(row.last_event_id).toBeNull()
      expect(row.last_event_at.toISOString()).toBe(tBackfill.toISOString())
    })
  })

  describe("deleteMembership", () => {
    test("deletes when the deletion event is newer than persisted state", async () => {
      const t0 = new Date("2026-01-01T00:00:00Z")
      const t1 = new Date("2026-01-01T00:00:10Z")

      await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["member"],
        eventId: "event_01",
        eventCreatedAt: t0,
      })

      const deleted = await WorkosAuthzRepository.deleteMembership(pool, {
        workosOrganizationId: orgId,
        workosUserId: userId,
        eventCreatedAt: t1,
      })

      expect(deleted).toBe(true)
      const after = await WorkosAuthzRepository.getByOrgAndUser(pool, orgId, userId)
      expect(after).toBeNull()
    })

    test("ignores stale delete events (INV-20)", async () => {
      const t0 = new Date("2026-01-01T00:00:00Z")
      const tEvent = new Date("2026-01-01T00:00:10Z")
      const tStaleDelete = new Date("2026-01-01T00:00:05Z") // between t0 and tEvent

      await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["admin"],
        eventId: "event_02",
        eventCreatedAt: tEvent,
      })

      const deleted = await WorkosAuthzRepository.deleteMembership(pool, {
        workosOrganizationId: orgId,
        workosUserId: userId,
        eventCreatedAt: tStaleDelete,
      })

      expect(deleted).toBe(false)
      const stillThere = await WorkosAuthzRepository.getByOrgAndUser(pool, orgId, userId)
      expect(stillThere).not.toBeNull()
      expect(stillThere!.role_slugs).toEqual(["admin"])

      // sanity: t0 was overwritten by tEvent
      void t0
    })
  })

  describe("reconcileOrganizationSnapshotReturning", () => {
    test("removes rows whose membership id is absent from the snapshot", async () => {
      const t0 = new Date("2026-01-01T00:00:00Z")
      const observedAt = new Date("2026-01-01T00:00:10Z")

      await WorkosAuthzRepository.upsertMembershipFromBackfill(pool, {
        organizationMembershipId: "om_keep",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["member"],
        observedAt: t0,
      })
      await WorkosAuthzRepository.upsertMembershipFromBackfill(pool, {
        organizationMembershipId: "om_drop",
        workosOrganizationId: orgId,
        workosUserId: otherUserId,
        status: "active",
        roleSlugs: ["member"],
        observedAt: t0,
      })

      const removed = await WorkosAuthzRepository.reconcileOrganizationSnapshotReturning(pool, {
        workosOrganizationId: orgId,
        snapshotMembershipIds: ["om_keep"],
        observedAt,
      })

      expect(removed.map((r) => r.workos_user_id)).toEqual([otherUserId])
      expect(await WorkosAuthzRepository.getByOrgAndUser(pool, orgId, userId)).not.toBeNull()
      expect(await WorkosAuthzRepository.getByOrgAndUser(pool, orgId, otherUserId)).toBeNull()
    })

    test("preserves rows the poller wrote after the snapshot was taken", async () => {
      const observedAt = new Date("2026-01-01T00:00:00Z")
      const tFreshEvent = new Date("2026-01-01T00:00:30Z")

      // Membership added by a concurrent event AFTER the backfill snapshot.
      await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_new",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["member"],
        eventId: "event_post_snapshot",
        eventCreatedAt: tFreshEvent,
      })

      const removed = await WorkosAuthzRepository.reconcileOrganizationSnapshotReturning(pool, {
        workosOrganizationId: orgId,
        snapshotMembershipIds: [],
        observedAt,
      })

      expect(removed).toEqual([])
      expect(await WorkosAuthzRepository.getByOrgAndUser(pool, orgId, userId)).not.toBeNull()
    })

    test("empty snapshot removes every (non-fresher) row for the org", async () => {
      const t0 = new Date("2026-01-01T00:00:00Z")
      const observedAt = new Date("2026-01-01T00:00:10Z")

      await WorkosAuthzRepository.upsertMembershipFromBackfill(pool, {
        organizationMembershipId: "om_a",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["member"],
        observedAt: t0,
      })
      await WorkosAuthzRepository.upsertMembershipFromBackfill(pool, {
        organizationMembershipId: "om_b",
        workosOrganizationId: orgId,
        workosUserId: otherUserId,
        status: "active",
        roleSlugs: ["member"],
        observedAt: t0,
      })

      const removed = await WorkosAuthzRepository.reconcileOrganizationSnapshotReturning(pool, {
        workosOrganizationId: orgId,
        snapshotMembershipIds: [],
        observedAt,
      })

      expect(removed).toHaveLength(2)
      expect(await WorkosAuthzRepository.listByOrganization(pool, orgId)).toEqual([])
    })
  })

  describe("listByOrganization", () => {
    test("returns rows for the org in created_at order", async () => {
      const t0 = new Date("2026-01-01T00:00:00Z")
      const t1 = new Date("2026-01-01T00:00:01Z")

      await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_1",
        workosOrganizationId: orgId,
        workosUserId: userId,
        status: "active",
        roleSlugs: ["member"],
        eventId: "event_01",
        eventCreatedAt: t0,
      })
      await WorkosAuthzRepository.upsertMembershipFromEvent(pool, {
        organizationMembershipId: "om_2",
        workosOrganizationId: orgId,
        workosUserId: otherUserId,
        status: "pending",
        roleSlugs: [],
        eventId: "event_02",
        eventCreatedAt: t1,
      })

      const rows = await WorkosAuthzRepository.listByOrganization(pool, orgId)
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.workos_user_id)).toEqual([userId, otherUserId])
    })
  })
})
