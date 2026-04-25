import { describe, expect, test } from "bun:test"
import { DEFAULT_WORKSPACE_ROLES } from "@threa/types"
import { getEffectiveWorkspaceRoles } from "./workspace-authz-resolver"

describe("resolveWorkspaceAuthorization", () => {
  test("falls back to built-in role catalog when the authz mirror has no roles yet", async () => {
    expect(getEffectiveWorkspaceRoles([]).map((role) => role.slug)).toEqual(
      DEFAULT_WORKSPACE_ROLES.map((role) => role.slug)
    )
  })
})
