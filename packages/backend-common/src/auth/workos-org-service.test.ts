import { describe, expect, test } from "bun:test"
import { filterWorkspacePermissionScopes } from "@threa/types"

describe("filterWorkspacePermissionScopes", () => {
  test("drops WorkOS widget permissions that are not workspace API scopes", () => {
    expect(filterWorkspacePermissionScopes(["messages:read", "widgets:api-keys:manage", "members:write"])).toEqual([
      "messages:read",
      "members:write",
    ])
  })
})
