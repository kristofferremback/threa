import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import type { Pool } from "pg"
import { StubWorkosOrgService } from "@threa/backend-common"
import {
  OUTBOX_AUTHZ_MEMBERSHIP_CHANGED,
  OUTBOX_AUTHZ_MEMBERSHIP_REMOVED,
  WorkosAuthzBackfill,
  WorkosAuthzRepository,
  type AuthzMembershipChangedPayload,
  type AuthzMembershipRemovedPayload,
} from "../../src/features/workos-authz"
import { setupTestDatabase } from "./setup"
import { cleanupAuthzOutbox, fetchAuthzOutbox } from "./_helpers/authz-outbox"

const ORG_ID = "org_backfill_test"
const USER_A = "user_backfill_a"
const USER_B = "user_backfill_b"
const WORKSPACE_ID = "ws_backfill_test"

describe("WorkosAuthzBackfill.run", () => {
  let pool: Pool

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM workspace_registry WHERE workos_organization_id = $1", [ORG_ID])
    await pool.query("DELETE FROM workos_organization_memberships WHERE workos_organization_id = $1", [ORG_ID])
    await cleanupAuthzOutbox(pool, ORG_ID)
    await pool.query(
      `INSERT INTO workspace_registry (id, name, slug, region, created_by_workos_user_id, workos_organization_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [WORKSPACE_ID, WORKSPACE_ID, "ws-backfill-test", "us-east-1", "user_test", ORG_ID]
    )
  })

  test("upserts memberships and emits one fan-out event per row", async () => {
    const stub = new StubWorkosOrgService()
    stub.setOrganizationMemberships(ORG_ID, [
      {
        id: "om_a",
        organizationId: ORG_ID,
        userId: USER_A,
        status: "active",
        roleSlugs: ["admin"],
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "om_b",
        organizationId: ORG_ID,
        userId: USER_B,
        status: "active",
        roleSlugs: ["member"],
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ])

    const backfill = new WorkosAuthzBackfill({ pool, workosOrgService: stub })
    const result = await backfill.run()

    expect(result.orgsScanned).toBe(1)
    expect(result.membershipsUpserted).toBe(2)
    expect(result.membershipsRemoved).toBe(0)

    const persisted = await WorkosAuthzRepository.listByOrganization(pool, ORG_ID)
    expect(persisted.map((r) => r.workos_user_id).sort()).toEqual([USER_A, USER_B].sort())

    const events = await fetchAuthzOutbox(pool, ORG_ID)
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.event_type === OUTBOX_AUTHZ_MEMBERSHIP_CHANGED)).toBe(true)
    const userIds = events.map((e) => (e.payload as unknown as AuthzMembershipChangedPayload).workosUserId).sort()
    expect(userIds).toEqual([USER_A, USER_B].sort())
  })

  test("emits a removal event for memberships absent from the snapshot", async () => {
    // Pre-existing mirror row for a user no longer in the org.
    const observedAt = new Date("2026-01-01T00:00:00Z")
    await WorkosAuthzRepository.upsertMembershipFromBackfill(pool, {
      organizationMembershipId: "om_stale",
      workosOrganizationId: ORG_ID,
      workosUserId: USER_B,
      status: "active",
      roleSlugs: ["member"],
      observedAt,
    })

    const stub = new StubWorkosOrgService()
    stub.setOrganizationMemberships(ORG_ID, [
      {
        id: "om_a",
        organizationId: ORG_ID,
        userId: USER_A,
        status: "active",
        roleSlugs: ["admin"],
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    ])

    const backfill = new WorkosAuthzBackfill({ pool, workosOrgService: stub })
    const result = await backfill.run()

    expect(result.membershipsUpserted).toBe(1)
    expect(result.membershipsRemoved).toBe(1)

    const events = await fetchAuthzOutbox(pool, ORG_ID)
    const changed = events.filter((e) => e.event_type === OUTBOX_AUTHZ_MEMBERSHIP_CHANGED)
    const removed = events.filter((e) => e.event_type === OUTBOX_AUTHZ_MEMBERSHIP_REMOVED)
    expect(changed).toHaveLength(1)
    expect((changed[0]!.payload as unknown as AuthzMembershipChangedPayload).workosUserId).toBe(USER_A)
    expect(removed).toHaveLength(1)
    expect((removed[0]!.payload as unknown as AuthzMembershipRemovedPayload).workosUserId).toBe(USER_B)
  })

  test("emits no events when the org has no memberships and no stale rows", async () => {
    const stub = new StubWorkosOrgService()
    stub.setOrganizationMemberships(ORG_ID, [])

    const backfill = new WorkosAuthzBackfill({ pool, workosOrgService: stub })
    const result = await backfill.run()

    expect(result.membershipsUpserted).toBe(0)
    expect(result.membershipsRemoved).toBe(0)
    expect(await fetchAuthzOutbox(pool, ORG_ID)).toEqual([])
  })
})
