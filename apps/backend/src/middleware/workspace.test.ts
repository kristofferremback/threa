import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { NextFunction, Request, Response } from "express"
import { SESSION_COOKIE_CLEAR_CONFIG, SESSION_COOKIE_NAME } from "@threa/backend-common"
import { createWorkspaceUserMiddleware } from "./workspace"
import { UserRepository } from "../features/workspaces"
import * as authzResolver from "./workspace-authz-resolver"

function createResponse() {
  const res: any = {
    statusCode: 200,
    body: null,
  }
  res.status = mock((code: number) => {
    res.statusCode = code
    return res
  })
  res.json = mock((body: unknown) => {
    res.body = body
    return res
  })
  res.cookie = mock(() => res)
  res.clearCookie = mock(() => res)
  return res as Response & {
    statusCode: number
    body: unknown
    cookie: ReturnType<typeof mock>
    clearCookie: ReturnType<typeof mock>
  }
}

describe("createWorkspaceUserMiddleware", () => {
  const findWorkspaceUserAccess = spyOn(UserRepository, "findWorkspaceUserAccess")
  const updateUser = spyOn(UserRepository, "update")
  const resolveWorkspaceAuthorization = spyOn(authzResolver, "resolveWorkspaceAuthorization")

  beforeEach(() => {
    findWorkspaceUserAccess.mockReset()
    updateUser.mockReset()
    resolveWorkspaceAuthorization.mockReset()
  })

  test("refreshes the session into the workspace org when the current session is for another org", async () => {
    findWorkspaceUserAccess.mockResolvedValue({
      workspaceExists: true,
      user: {
        id: "user_1",
        workspaceId: "ws_1",
        workosUserId: "wos_1",
        email: "user@example.com",
        role: "user",
        slug: "user",
        name: "User",
        description: null,
        avatarUrl: null,
        timezone: null,
        locale: null,
        pronouns: null,
        phone: null,
        githubUsername: null,
        setupCompleted: true,
        joinedAt: new Date(),
        assignedRole: null,
        assignedRoles: [],
        canEditRole: false,
      },
    } as never)
    resolveWorkspaceAuthorization
      .mockResolvedValueOnce({ status: "org_mismatch", organizationId: "org_ws" } as never)
      .mockResolvedValueOnce({
        status: "ok",
        value: {
          source: "session",
          organizationId: "org_ws",
          organizationMembershipId: null,
          permissions: new Set(["messages:read"]),
          assignedRoles: [{ slug: "member", name: "Member" }],
          canEditRole: true,
          compatibilityRole: "user",
          isOwner: false,
        },
      } as never)
    updateUser.mockResolvedValue(null as never)

    const authService = {
      refreshSession: mock(async () => ({
        success: true,
        refreshed: true,
        sealedSession: "session_new",
        user: {
          id: "wos_1",
          email: "user@example.com",
          firstName: "User",
          lastName: null,
        },
        session: {
          organizationId: "org_ws",
          role: "member",
          roles: ["member"],
          permissions: ["messages:read"],
        },
      })),
    } as any

    const middleware = createWorkspaceUserMiddleware({ pool: {} as never, authService })
    const req = {
      params: { workspaceId: "ws_1" },
      cookies: { [SESSION_COOKIE_NAME]: "session_old" },
      workosUserId: "wos_1",
      authSession: {
        sealedSession: "session_old",
        organizationId: "org_other",
        role: "member",
        roles: ["member"],
        permissions: ["messages:read"],
      },
    } as unknown as Request
    const res = createResponse()
    let nextCalled = false

    await middleware(req, res, (() => {
      nextCalled = true
    }) as NextFunction)

    expect(authService.refreshSession).toHaveBeenCalledWith({
      sealedSession: "session_old",
      organizationId: "org_ws",
    })
    expect(res.cookie).toHaveBeenCalled()
    expect(req.authSession).toMatchObject({
      sealedSession: "session_new",
      organizationId: "org_ws",
      roles: ["member"],
    })
    expect(nextCalled).toBe(true)
    expect(req.workspaceId).toBe("ws_1")
  })

  test("clears the session cookie with matching attributes when org refresh fails", async () => {
    findWorkspaceUserAccess.mockResolvedValue({
      workspaceExists: true,
      user: {
        id: "user_1",
        workspaceId: "ws_1",
        workosUserId: "wos_1",
        email: "user@example.com",
        role: "user",
        slug: "user",
        name: "User",
        description: null,
        avatarUrl: null,
        timezone: null,
        locale: null,
        pronouns: null,
        phone: null,
        githubUsername: null,
        setupCompleted: true,
        joinedAt: new Date(),
        assignedRole: null,
        assignedRoles: [],
        canEditRole: false,
      },
    } as never)
    resolveWorkspaceAuthorization.mockResolvedValue({ status: "org_mismatch", organizationId: "org_ws" } as never)

    const authService = {
      refreshSession: mock(async () => ({ success: false })),
    } as any

    const middleware = createWorkspaceUserMiddleware({ pool: {} as never, authService })
    const req = {
      params: { workspaceId: "ws_1" },
      cookies: { [SESSION_COOKIE_NAME]: "session_old" },
      workosUserId: "wos_1",
      authSession: {
        sealedSession: "session_old",
        organizationId: "org_other",
        role: "member",
        roles: ["member"],
        permissions: ["messages:read"],
      },
    } as unknown as Request
    const res = createResponse()
    let nextCalled = false

    await middleware(req, res, (() => {
      nextCalled = true
    }) as NextFunction)

    expect(res.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME, SESSION_COOKIE_CLEAR_CONFIG)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: "Session expired" })
    expect(nextCalled).toBe(false)
  })

  test("preserves legacy owner rows while authorizing from permissions", async () => {
    findWorkspaceUserAccess.mockResolvedValue({
      workspaceExists: true,
      user: {
        id: "owner_1",
        workspaceId: "ws_1",
        workosUserId: "wos_1",
        email: "owner@example.com",
        role: "owner",
        slug: "owner",
        name: "Owner",
        description: null,
        avatarUrl: null,
        timezone: null,
        locale: null,
        pronouns: null,
        phone: null,
        githubUsername: null,
        setupCompleted: true,
        joinedAt: new Date(),
        assignedRole: null,
        assignedRoles: [],
        canEditRole: false,
      },
    } as never)
    resolveWorkspaceAuthorization.mockResolvedValue({
      status: "ok",
      value: {
        source: "session",
        organizationId: "org_ws",
        organizationMembershipId: null,
        permissions: new Set(["messages:read", "members:write"]),
        assignedRoles: [{ slug: "admin", name: "Admin" }],
        canEditRole: true,
        compatibilityRole: "admin",
        isOwner: true,
      },
    } as never)

    const middleware = createWorkspaceUserMiddleware({
      pool: {} as never,
      authService: { refreshSession: mock(async () => ({ success: false })) } as never,
    })
    const req = {
      params: { workspaceId: "ws_1" },
      workosUserId: "wos_1",
      authSession: {
        sealedSession: "session_owner",
        organizationId: "org_ws",
        role: "admin",
        roles: ["admin"],
        permissions: ["messages:read", "members:write"],
      },
    } as unknown as Request
    const res = createResponse()
    let nextCalled = false

    await middleware(req, res, (() => {
      nextCalled = true
    }) as NextFunction)

    expect(updateUser).not.toHaveBeenCalled()
    expect(req.user?.role).toBe("owner")
    expect(req.user?.isOwner).toBe(true)
    expect(nextCalled).toBe(true)
  })
})
