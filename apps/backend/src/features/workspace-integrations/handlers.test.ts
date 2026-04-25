import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { Request } from "express"
import { SESSION_COOKIE_CLEAR_CONFIG, SESSION_COOKIE_NAME } from "@threa/backend-common"
import { buildGithubCallbackRedirectUrl, createWorkspaceIntegrationHandlers } from "./handlers"
import { UserRepository } from "../workspaces"
import * as authzResolver from "../../middleware/workspace-authz-resolver"

describe("buildGithubCallbackRedirectUrl", () => {
  const allowedOrigins = ["http://localhost:3000", "https://app.threa.io"]

  test("returns an absolute frontend URL when the forwarded origin is allowlisted", () => {
    const url = buildGithubCallbackRedirectUrl(
      {
        headers: {
          "x-forwarded-host": "localhost:3000",
          "x-forwarded-proto": "http",
        },
        protocol: "http",
      } as any,
      "ws_123",
      allowedOrigins
    )

    expect(url).toBe("http://localhost:3000/w/ws_123?ws-settings=integrations&provider=github")
  })

  test("prefers x-forwarded-port over an intermediate proxy port in the host header", () => {
    const url = buildGithubCallbackRedirectUrl(
      {
        headers: {
          "x-forwarded-host": "localhost:3001",
          "x-forwarded-proto": "http",
          "x-forwarded-port": "3000",
        },
        protocol: "http",
      } as any,
      "ws_123",
      allowedOrigins
    )

    expect(url).toBe("http://localhost:3000/w/ws_123?ws-settings=integrations&provider=github")
  })

  test("falls back to a relative workspace path without forwarded headers", () => {
    const url = buildGithubCallbackRedirectUrl(
      {
        headers: {},
        protocol: "https",
      } as any,
      "ws_123",
      allowedOrigins
    )

    expect(url).toBe("/w/ws_123?ws-settings=integrations&provider=github")
  })

  test("falls back to a relative path when the forwarded origin is not in the allowlist", () => {
    const url = buildGithubCallbackRedirectUrl(
      {
        headers: {
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        },
        protocol: "https",
      } as any,
      "ws_123",
      allowedOrigins
    )

    expect(url).toBe("/w/ws_123?ws-settings=integrations&provider=github")
  })

  test("falls back to a relative path when the forwarded host is malformed", () => {
    const url = buildGithubCallbackRedirectUrl(
      {
        headers: {
          "x-forwarded-host": "not a valid host",
          "x-forwarded-proto": "https",
        },
        protocol: "https",
      } as any,
      "ws_123",
      allowedOrigins
    )

    expect(url).toBe("/w/ws_123?ws-settings=integrations&provider=github")
  })
})

describe("createWorkspaceIntegrationHandlers.githubCallback", () => {
  const findWorkspaceUserAccess = spyOn(UserRepository, "findWorkspaceUserAccess")
  const resolveWorkspaceAuthorization = spyOn(authzResolver, "resolveWorkspaceAuthorization")

  beforeEach(() => {
    findWorkspaceUserAccess.mockReset()
    resolveWorkspaceAuthorization.mockReset()
  })

  test("refreshes the session into the workspace org before completing the install", async () => {
    const workspaceIntegrationService = {
      resolveGithubCallbackWorkspaceId: mock(() => "ws_123"),
      completeGithubInstallation: mock(async () => undefined),
    } as any
    const authService = {
      refreshSession: mock(async () => ({
        success: true,
        refreshed: true,
        sealedSession: "session_new",
        user: {
          id: "wos_1",
          email: "owner@example.com",
          firstName: "Owner",
          lastName: null,
        },
        session: {
          organizationId: "org_ws",
          role: "admin",
          roles: ["admin"],
          permissions: ["workspace:admin"],
        },
      })),
    } as any

    findWorkspaceUserAccess.mockResolvedValue({
      workspaceExists: true,
      user: {
        id: "owner_1",
        workspaceId: "ws_123",
        workosUserId: "wos_1",
        email: "owner@example.com",
        role: "admin",
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
    resolveWorkspaceAuthorization
      .mockResolvedValueOnce({ status: "org_mismatch", organizationId: "org_ws" } as never)
      .mockResolvedValueOnce({
        status: "ok",
        value: {
          source: "session",
          organizationId: "org_ws",
          organizationMembershipId: null,
          permissions: new Set(["workspace:admin"]),
          assignedRoles: [{ slug: "admin", name: "Admin" }],
          canEditRole: true,
          compatibilityRole: "admin",
          isOwner: true,
        },
      } as never)

    const handlers = createWorkspaceIntegrationHandlers({
      workspaceIntegrationService,
      authService,
      pool: {} as any,
      allowedFrontendOrigins: ["https://app.threa.io"],
    })

    const req = {
      query: {
        installation_id: "123",
        state: "signed_state",
      },
      headers: {
        "x-forwarded-host": "app.threa.io",
        "x-forwarded-proto": "https",
      },
      protocol: "https",
      cookies: {
        [SESSION_COOKIE_NAME]: "session_old",
      },
      workosUserId: "wos_1",
      authSession: {
        sealedSession: "session_old",
        organizationId: "org_other",
        role: "member",
        roles: ["member"],
        permissions: ["messages:read"],
      },
    } as unknown as Request
    const res: any = {
      cookie: mock(() => res),
      clearCookie: mock(() => res),
      redirect: mock(() => res),
      status: mock(() => res),
      json: mock(() => res),
    }

    await handlers.githubCallback(req, res)

    expect(authService.refreshSession).toHaveBeenCalledWith({
      sealedSession: "session_old",
      organizationId: "org_ws",
    })
    expect(workspaceIntegrationService.completeGithubInstallation).toHaveBeenCalledWith("ws_123", "owner_1", "123")
    expect(res.cookie).toHaveBeenCalled()
    expect(res.redirect).toHaveBeenCalledWith("https://app.threa.io/w/ws_123?ws-settings=integrations&provider=github")
  })

  test("clears the session cookie with matching attributes when org refresh fails", async () => {
    const workspaceIntegrationService = {
      resolveGithubCallbackWorkspaceId: mock(() => "ws_123"),
      completeGithubInstallation: mock(async () => undefined),
    } as any
    const authService = {
      refreshSession: mock(async () => ({ success: false })),
    } as any

    findWorkspaceUserAccess.mockResolvedValue({
      workspaceExists: true,
      user: {
        id: "owner_1",
        workspaceId: "ws_123",
        workosUserId: "wos_1",
        email: "owner@example.com",
        role: "admin",
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
    resolveWorkspaceAuthorization.mockResolvedValue({ status: "org_mismatch", organizationId: "org_ws" } as never)

    const handlers = createWorkspaceIntegrationHandlers({
      workspaceIntegrationService,
      authService,
      pool: {} as any,
      allowedFrontendOrigins: ["https://app.threa.io"],
    })

    const req = {
      query: {
        installation_id: "123",
        state: "signed_state",
      },
      headers: {},
      protocol: "https",
      cookies: {
        [SESSION_COOKIE_NAME]: "session_old",
      },
      workosUserId: "wos_1",
      authSession: {
        sealedSession: "session_old",
        organizationId: "org_other",
        role: "member",
        roles: ["member"],
        permissions: ["messages:read"],
      },
    } as unknown as Request
    const res: any = {
      cookie: mock(() => res),
      clearCookie: mock(() => res),
      redirect: mock(() => res),
      status: mock(() => res),
      json: mock(() => res),
    }

    await expect(handlers.githubCallback(req, res)).rejects.toMatchObject({
      message: "Session expired",
      status: 401,
      code: "SESSION_EXPIRED",
    })
    expect(res.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME, SESSION_COOKIE_CLEAR_CONFIG)
    expect(workspaceIntegrationService.completeGithubInstallation).not.toHaveBeenCalled()
  })
})
