import { beforeEach, describe, expect, spyOn, test } from "bun:test"
import { DEFAULT_WORKSPACE_ROLES } from "@threa/types"
import { WorkspaceRepository, WorkosAuthzMirrorRepository } from "../features/workspaces"
import { resolveWorkspaceAuthorization } from "./workspace-authz-resolver"

describe("resolveWorkspaceAuthorization", () => {
  const mockGetAuthorizationMetadata = spyOn(WorkspaceRepository, "getAuthorizationMetadata")
  const mockListRoles = spyOn(WorkosAuthzMirrorRepository, "listRoles")

  beforeEach(() => {
    mockGetAuthorizationMetadata.mockReset().mockResolvedValue({
      createdBy: "user_1",
      workosOrganizationId: "org_1",
    } as never)
    mockListRoles.mockReset().mockResolvedValue([] as never)
  })

  test("falls back to built-in role catalog when the authz mirror has no roles yet", async () => {
    const result = await resolveWorkspaceAuthorization({
      pool: {} as never,
      workspaceId: "ws_1",
      userId: "user_1",
      source: "session",
      session: {
        organizationId: "org_1",
        role: null,
        roles: ["admin"],
        permissions: ["members:write"],
      },
    })

    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(result.value.roles?.map((role) => role.slug)).toEqual(DEFAULT_WORKSPACE_ROLES.map((role) => role.slug))
    expect(result.value.assignedRoles).toEqual([{ slug: "admin", name: "Admin" }])
  })
})
