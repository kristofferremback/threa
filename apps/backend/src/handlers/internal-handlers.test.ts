import { describe, expect, mock, test } from "bun:test"
import { createInternalHandlers } from "./internal-handlers"

describe("internal handlers", () => {
  test("filters unsupported WorkOS permissions from authz snapshots before applying them", async () => {
    const applyWorkosAuthzSnapshot = mock(async () => true)
    const handlers = createInternalHandlers({
      workspaceService: { applyWorkosAuthzSnapshot } as never,
      invitationService: {} as never,
    })
    const res = createResponse()

    await handlers.applyWorkspaceAuthzSnapshot(
      {
        params: { workspaceId: "ws_1" },
        body: {
          workspaceId: "ws_1",
          workosOrganizationId: "org_1",
          revision: "1",
          generatedAt: "2026-04-25T13:30:20.571Z",
          roles: [
            {
              slug: "admin",
              name: "Admin",
              description: null,
              permissions: ["messages:read", "widgets:api-keys:manage", "members:write"],
              type: "EnvironmentRole",
            },
          ],
          memberships: [],
        },
      } as never,
      res as never
    )

    expect(applyWorkosAuthzSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: [
          expect.objectContaining({
            permissions: ["messages:read", "members:write"],
          }),
        ],
      })
    )
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ applied: true })
  })
})

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
  }
}
