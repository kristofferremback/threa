import { describe, expect, mock, test } from "bun:test"
import type { Querier } from "../../db"
import { WorkosAuthzMirrorRepository } from "./workos-authz-mirror-repository"
import type { WorkspaceAuthzSnapshot } from "@threa/types"

interface CapturedQuery {
  text: string
  values: unknown[]
}

function createMockDb(): { db: Querier; query: ReturnType<typeof mock<(query: CapturedQuery) => Promise<unknown>>> } {
  const query = mock<(query: CapturedQuery) => Promise<unknown>>(async (queryTextOrConfig) => {
    const text = typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig.text
    if (text.includes("INSERT INTO workos_workspace_authz_state")) {
      return { rows: [], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  })

  return {
    db: {
      query: query as unknown as Querier["query"],
    },
    query,
  }
}

function findJsonValue(query: CapturedQuery): unknown[] {
  const jsonValue = query.values.find((value) => typeof value === "string" && value.trim().startsWith("["))
  expect(jsonValue).toBeDefined()
  return JSON.parse(jsonValue as string)
}

describe("WorkosAuthzMirrorRepository", () => {
  test("upsertMembershipRoles serializes role rows using snake_case keys for jsonb_to_recordset", async () => {
    const { db, query } = createMockDb()

    await WorkosAuthzMirrorRepository.upsertMembershipRoles({
      db,
      workspaceId: "ws_1",
      organizationMembershipId: "om_1",
      workosUserId: "wos_1",
      roleSlugs: ["admin", "member"],
    })

    const insertRolesQuery = query.mock.calls
      .map(([queryTextOrConfig]) => queryTextOrConfig as CapturedQuery)
      .find((captured) => captured.text.includes("INSERT INTO workos_workspace_membership_roles"))

    expect(insertRolesQuery).toBeDefined()
    expect(findJsonValue(insertRolesQuery!)).toEqual([
      { role_slug: "admin", position: 0 },
      { role_slug: "member", position: 1 },
    ])
  })

  test("applySnapshot serializes memberships and membership roles using snake_case keys", async () => {
    const { db, query } = createMockDb()
    const snapshot: WorkspaceAuthzSnapshot = {
      workspaceId: "ws_1",
      workosOrganizationId: "org_1",
      revision: "1",
      generatedAt: new Date().toISOString(),
      roles: [
        {
          slug: "member",
          name: "Member",
          description: null,
          permissions: ["messages:read"],
          type: "environment_role",
        },
      ],
      memberships: [
        {
          organizationMembershipId: "om_1",
          workosUserId: "wos_1",
          roleSlugs: ["member"],
        },
      ],
    }

    const applied = await WorkosAuthzMirrorRepository.applySnapshot(db, snapshot)

    expect(applied).toBe(true)

    const insertMembershipsQuery = query.mock.calls
      .map(([queryTextOrConfig]) => queryTextOrConfig as CapturedQuery)
      .find((captured) => captured.text.includes("INSERT INTO workos_workspace_memberships"))
    expect(insertMembershipsQuery).toBeDefined()
    expect(findJsonValue(insertMembershipsQuery!)).toEqual([
      {
        organization_membership_id: "om_1",
        workos_user_id: "wos_1",
        role_slugs: ["member"],
      },
    ])

    const insertMembershipRolesQuery = query.mock.calls
      .map(([queryTextOrConfig]) => queryTextOrConfig as CapturedQuery)
      .find((captured) => captured.text.includes("INSERT INTO workos_workspace_membership_roles"))
    expect(insertMembershipRolesQuery).toBeDefined()
    expect(findJsonValue(insertMembershipRolesQuery!)).toEqual([
      {
        organization_membership_id: "om_1",
        role_slug: "member",
        position: 0,
      },
    ])
  })
})
