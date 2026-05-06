import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import type { Pool } from "pg"
import { WorkosAuthzRepository, WorkosAuthzService } from "../../src/features/workos-authz"
import type { WorkosMembershipEvent } from "@threa/backend-common"
import { setupTestDatabase } from "./setup"

describe("WorkosAuthzService.processEvent", () => {
  let pool: Pool
  let service: WorkosAuthzService
  const orgId = "org_test_authz_service"
  const userId = "user_test_authz_service"

  beforeAll(async () => {
    pool = await setupTestDatabase()
    service = new WorkosAuthzService({ pool })
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM workos_organization_memberships WHERE workos_organization_id = $1", [orgId])
  })

  function makeEvent(
    type: WorkosMembershipEvent["type"],
    overrides: Partial<{ id: string; createdAt: Date; status: string; roleSlugs: string[] }> = {}
  ): WorkosMembershipEvent {
    return {
      id: overrides.id ?? "event_01",
      type,
      createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00Z"),
      membership: {
        id: "om_1",
        organizationId: orgId,
        userId,
        status: (overrides.status as WorkosMembershipEvent["membership"]["status"]) ?? "active",
        roleSlugs: overrides.roleSlugs ?? ["member"],
        updatedAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00Z"),
      },
    }
  }

  test("created upserts a new mirror row", async () => {
    await service.processEvent(makeEvent("organization_membership.created"))

    const row = await WorkosAuthzRepository.getByOrgAndUser(pool, orgId, userId)
    expect(row).not.toBeNull()
    expect(row!.status).toBe("active")
    expect(row!.role_slugs).toEqual(["member"])
    expect(row!.last_event_id).toBe("event_01")
  })

  test("updated overwrites an existing row", async () => {
    await service.processEvent(makeEvent("organization_membership.created"))
    await service.processEvent(
      makeEvent("organization_membership.updated", {
        id: "event_02",
        createdAt: new Date("2026-01-01T00:00:01Z"),
        roleSlugs: ["admin"],
      })
    )

    const row = await WorkosAuthzRepository.getByOrgAndUser(pool, orgId, userId)
    expect(row!.role_slugs).toEqual(["admin"])
    expect(row!.last_event_id).toBe("event_02")
  })

  test("deleted removes the mirror row", async () => {
    await service.processEvent(makeEvent("organization_membership.created"))
    await service.processEvent(
      makeEvent("organization_membership.deleted", {
        id: "event_03",
        createdAt: new Date("2026-01-01T00:00:01Z"),
      })
    )

    const row = await WorkosAuthzRepository.getByOrgAndUser(pool, orgId, userId)
    expect(row).toBeNull()
  })

  test("stale events are silently ignored", async () => {
    await service.processEvent(
      makeEvent("organization_membership.updated", {
        id: "event_recent",
        createdAt: new Date("2026-01-02T00:00:00Z"),
        roleSlugs: ["admin"],
      })
    )

    // Older event should be a no-op via the timestamp guard.
    await service.processEvent(
      makeEvent("organization_membership.updated", {
        id: "event_stale",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        roleSlugs: ["member"],
      })
    )

    const row = await WorkosAuthzRepository.getByOrgAndUser(pool, orgId, userId)
    expect(row!.role_slugs).toEqual(["admin"])
    expect(row!.last_event_id).toBe("event_recent")
  })
})
