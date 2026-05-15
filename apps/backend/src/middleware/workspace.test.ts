import { afterEach, describe, expect, spyOn, test } from "bun:test"
import type { NextFunction, Request, Response } from "express"
import { createWorkspaceUserMiddleware } from "./workspace"
import { UserRepository } from "../features/workspaces"

const mockFindAccess = spyOn(UserRepository, "findWorkspaceUserAccess")

afterEach(() => {
  mockFindAccess.mockReset()
})

const POOL = {} as never

const AUTH_USER = {
  id: "workos_user_1",
  email: "user@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  permissions: null,
}

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    params: { workspaceId: "ws_1" },
    workosUserId: "workos_user_1",
    authUser: AUTH_USER,
    ...overrides,
  } as Request
}

interface RunResult {
  status: number | null
  body: unknown
  nextCalled: boolean
  req: Request
}

function runMiddleware(middleware: ReturnType<typeof createWorkspaceUserMiddleware>, req: Request): Promise<RunResult> {
  return new Promise((resolve) => {
    let status: number | null = null
    let body: unknown = null
    let settled = false
    const settle = (nextCalled: boolean) => {
      if (settled) return
      settled = true
      resolve({ status, body, nextCalled, req })
    }

    const res = {
      status(code: number) {
        status = code
        return this
      },
      json(payload: unknown) {
        body = payload
        settle(false)
        return this
      },
    } as unknown as Response

    const next: NextFunction = () => settle(true)

    Promise.resolve(middleware(req, res, next)).then(() => {
      if (!settled) settle(false)
    })
  })
}

function provisionedService(user: unknown) {
  return { ensureUserProvisioned: async () => user } as never
}

describe("createWorkspaceUserMiddleware", () => {
  test("passes through when there is no workspaceId param", async () => {
    const mw = createWorkspaceUserMiddleware({
      pool: POOL,
      workspaceService: provisionedService(null),
      controlPlaneClient: null,
    })
    const { nextCalled, status } = await runMiddleware(mw, createReq({ params: {} as Request["params"] }))

    expect(nextCalled).toBe(true)
    expect(status).toBeNull()
  })

  test("401 when not authenticated", async () => {
    const mw = createWorkspaceUserMiddleware({
      pool: POOL,
      workspaceService: provisionedService(null),
      controlPlaneClient: null,
    })
    const { status, nextCalled } = await runMiddleware(mw, createReq({ workosUserId: undefined }))

    expect(status).toBe(401)
    expect(nextCalled).toBe(false)
  })

  test("404 when the workspace does not exist", async () => {
    mockFindAccess.mockResolvedValueOnce({ workspaceExists: false, user: null })
    const mw = createWorkspaceUserMiddleware({
      pool: POOL,
      workspaceService: provisionedService(null),
      controlPlaneClient: null,
    })
    const { status } = await runMiddleware(mw, createReq())

    expect(status).toBe(404)
  })

  test("attaches the existing user and calls next", async () => {
    const user = { id: "usr_1", workspaceId: "ws_1" }
    mockFindAccess.mockResolvedValueOnce({ workspaceExists: true, user: user as never })
    const mw = createWorkspaceUserMiddleware({
      pool: POOL,
      workspaceService: provisionedService(null),
      controlPlaneClient: null,
    })
    const { nextCalled, req } = await runMiddleware(mw, createReq())

    expect(nextCalled).toBe(true)
    expect(req.user).toEqual(user as never)
    expect(req.workspaceId).toBe("ws_1")
  })

  test("403 when the user is missing and no control-plane client is configured", async () => {
    mockFindAccess.mockResolvedValueOnce({ workspaceExists: true, user: null })
    const mw = createWorkspaceUserMiddleware({
      pool: POOL,
      workspaceService: provisionedService(null),
      controlPlaneClient: null,
    })
    const { status } = await runMiddleware(mw, createReq())

    expect(status).toBe(403)
  })

  test("403 when the control plane reports the user is not a member", async () => {
    mockFindAccess.mockResolvedValueOnce({ workspaceExists: true, user: null })
    const mw = createWorkspaceUserMiddleware({
      pool: POOL,
      workspaceService: provisionedService(null),
      controlPlaneClient: { getWorkspaceMembership: async () => ({ member: false }) } as never,
    })
    const { status } = await runMiddleware(mw, createReq())

    expect(status).toBe(403)
  })

  test("403 (fail closed) when the control plane lookup throws", async () => {
    mockFindAccess.mockResolvedValueOnce({ workspaceExists: true, user: null })
    const mw = createWorkspaceUserMiddleware({
      pool: POOL,
      workspaceService: provisionedService(null),
      controlPlaneClient: {
        getWorkspaceMembership: async () => {
          throw new Error("control-plane unreachable")
        },
      } as never,
    })
    const { status } = await runMiddleware(mw, createReq())

    expect(status).toBe(403)
  })

  test("self-heals and calls next when the control plane confirms membership", async () => {
    const healed = { id: "usr_healed", workspaceId: "ws_1" }
    mockFindAccess.mockResolvedValueOnce({ workspaceExists: true, user: null })
    const mw = createWorkspaceUserMiddleware({
      pool: POOL,
      workspaceService: provisionedService(healed),
      controlPlaneClient: { getWorkspaceMembership: async () => ({ member: true }) } as never,
    })
    const { nextCalled, status, req } = await runMiddleware(mw, createReq())

    expect(status).toBeNull()
    expect(nextCalled).toBe(true)
    expect(req.user).toEqual(healed as never)
    expect(req.workspaceId).toBe("ws_1")
  })

  test("403 when the user is missing and there is no WorkOS identity to provision from", async () => {
    mockFindAccess.mockResolvedValueOnce({ workspaceExists: true, user: null })
    const mw = createWorkspaceUserMiddleware({
      pool: POOL,
      workspaceService: provisionedService({ id: "usr_x" }),
      controlPlaneClient: { getWorkspaceMembership: async () => ({ member: true }) } as never,
    })
    const { status } = await runMiddleware(mw, createReq({ authUser: undefined }))

    expect(status).toBe(403)
  })
})
