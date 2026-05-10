import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import type { Pool } from "pg"
import { RegionalAuthzFanOut } from "../../src/features/workos-authz"
import type { RegionalClient } from "../../src/lib/regional-client"
import { setupTestDatabase } from "./setup"

const ORG_ID = "org_fanout_test"
const OTHER_ORG_ID = "org_fanout_other"

interface SyncCall {
  region: string
  workspaceId: string
  workosUserId: string
  roleSlugs: string[]
  status: string
  lastEventAt: Date
}

interface RemoveCall {
  region: string
  workspaceId: string
  workosUserId: string
  eventCreatedAt: Date
}

class RecordingRegionalClient {
  syncCalls: SyncCall[] = []
  removeCalls: RemoveCall[] = []
  failNext = false

  async syncWorkspaceMembership(region: string, data: Omit<SyncCall, "region">): Promise<void> {
    if (this.failNext) {
      this.failNext = false
      throw new Error("regional sync failed")
    }
    this.syncCalls.push({ region, ...data })
  }

  async removeWorkspaceMembership(region: string, data: Omit<RemoveCall, "region">): Promise<void> {
    if (this.failNext) {
      this.failNext = false
      throw new Error("regional remove failed")
    }
    this.removeCalls.push({ region, ...data })
  }
}

describe("RegionalAuthzFanOut", () => {
  let pool: Pool
  let regionalClient: RecordingRegionalClient
  let fanOut: RegionalAuthzFanOut

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    regionalClient = new RecordingRegionalClient()
    fanOut = new RegionalAuthzFanOut({
      pool,
      regionalClient: regionalClient as unknown as RegionalClient,
    })
    await pool.query("DELETE FROM workspace_registry WHERE workos_organization_id = ANY($1::text[])", [
      [ORG_ID, OTHER_ORG_ID],
    ])
  })

  async function insertWorkspace(id: string, region: string, orgId: string | null): Promise<void> {
    await pool.query(
      `INSERT INTO workspace_registry (id, name, slug, region, created_by_workos_user_id, workos_organization_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, id, id.replace(/_/g, "-"), region, "user_test", orgId]
    )
  }

  test("handleMembershipChanged dispatches one call per workspace mapped to the org", async () => {
    await insertWorkspace("ws_fan_a", "us-east-1", ORG_ID)
    await insertWorkspace("ws_fan_b", "eu-west-1", ORG_ID)
    await insertWorkspace("ws_fan_other", "us-east-1", OTHER_ORG_ID)

    await fanOut.handleMembershipChanged({
      workosOrganizationId: ORG_ID,
      workosUserId: "user_42",
      roleSlugs: ["admin"],
      status: "active",
      lastEventAt: "2026-01-01T00:00:00.000Z",
    })

    expect(regionalClient.syncCalls).toHaveLength(2)
    const byWorkspace = Object.fromEntries(regionalClient.syncCalls.map((c) => [c.workspaceId, c]))
    expect(byWorkspace.ws_fan_a.region).toBe("us-east-1")
    expect(byWorkspace.ws_fan_b.region).toBe("eu-west-1")
    expect(byWorkspace.ws_fan_a.workosUserId).toBe("user_42")
    expect(byWorkspace.ws_fan_a.roleSlugs).toEqual(["admin"])
    expect(byWorkspace.ws_fan_a.status).toBe("active")
    expect(byWorkspace.ws_fan_a.lastEventAt.toISOString()).toBe("2026-01-01T00:00:00.000Z")
  })

  test("handleMembershipChanged is a no-op when no workspaces are mapped to the org", async () => {
    await insertWorkspace("ws_fan_other", "us-east-1", OTHER_ORG_ID)

    await fanOut.handleMembershipChanged({
      workosOrganizationId: ORG_ID,
      workosUserId: "user_42",
      roleSlugs: ["member"],
      status: "active",
      lastEventAt: "2026-01-01T00:00:00.000Z",
    })

    expect(regionalClient.syncCalls).toEqual([])
  })

  test("handleMembershipChanged forwards roleSlugs verbatim, including unknown slugs", async () => {
    await insertWorkspace("ws_fan_a", "us-east-1", ORG_ID)

    await fanOut.handleMembershipChanged({
      workosOrganizationId: ORG_ID,
      workosUserId: "user_42",
      roleSlugs: ["member", "admin", "future_role_not_in_code"],
      status: "active",
      lastEventAt: "2026-01-01T00:00:00.000Z",
    })

    const sent = regionalClient.syncCalls[0]!
    expect(sent.roleSlugs).toEqual(["member", "admin", "future_role_not_in_code"])
  })

  test("handleMembershipChanged aggregates regional failures into AggregateError", async () => {
    await insertWorkspace("ws_fan_a", "us-east-1", ORG_ID)
    regionalClient.failNext = true

    await expect(
      fanOut.handleMembershipChanged({
        workosOrganizationId: ORG_ID,
        workosUserId: "user_42",
        roleSlugs: ["admin"],
        status: "active",
        lastEventAt: "2026-01-01T00:00:00.000Z",
      })
    ).rejects.toBeInstanceOf(AggregateError)
  })

  test("handleMembershipRemoved dispatches one removal per workspace mapped to the org", async () => {
    await insertWorkspace("ws_fan_a", "us-east-1", ORG_ID)
    await insertWorkspace("ws_fan_b", "eu-west-1", ORG_ID)
    await insertWorkspace("ws_fan_other", "us-east-1", OTHER_ORG_ID)

    await fanOut.handleMembershipRemoved({
      workosOrganizationId: ORG_ID,
      workosUserId: "user_42",
      eventCreatedAt: "2026-01-01T00:00:00.000Z",
    })

    expect(regionalClient.removeCalls).toHaveLength(2)
    const regions = regionalClient.removeCalls.map((c) => c.region).sort()
    expect(regions).toEqual(["eu-west-1", "us-east-1"])
    for (const call of regionalClient.removeCalls) {
      expect(call.workosUserId).toBe("user_42")
      expect(call.eventCreatedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z")
    }
  })

  test("handleMembershipRemoved is a no-op when no workspaces are mapped to the org", async () => {
    await fanOut.handleMembershipRemoved({
      workosOrganizationId: ORG_ID,
      workosUserId: "user_42",
      eventCreatedAt: "2026-01-01T00:00:00.000Z",
    })

    expect(regionalClient.removeCalls).toEqual([])
  })
})
