import type { Express, Request } from "express"
import {
  createAuthMiddleware,
  createRateLimit,
  getClientIp,
  errorHandler,
  type AuthService,
  StubAuthService,
} from "@threa/backend-common"
import { createControlPlaneAuthHandlers, createAuthStubHandlers } from "./features/auth"
import { createWorkspaceHandlers, type ControlPlaneWorkspaceService } from "./features/workspaces"
import { createInvitationShadowHandlers, type InvitationShadowService } from "./features/invitation-shadows"
import { createInternalAuthMiddleware } from "./lib/internal-auth"

interface RateLimitConfig {
  globalMax: number
  authMax: number
}

interface Dependencies {
  authService: AuthService
  workspaceService: ControlPlaneWorkspaceService
  shadowService: InvitationShadowService
  internalApiKey: string
  allowDevAuthRoutes: boolean
  rateLimits: RateLimitConfig
}

export function registerRoutes(app: Express, deps: Dependencies) {
  const { authService, workspaceService, shadowService, internalApiKey, allowDevAuthRoutes } = deps

  const auth = createAuthMiddleware({ authService })
  const internalAuth = createInternalAuthMiddleware(internalApiKey)

  const ipKey = (req: Request) => getClientIp(req, "unknown")
  const globalLimit = createRateLimit({
    name: "cp-global",
    windowMs: 60_000,
    max: deps.rateLimits.globalMax,
    key: ipKey,
  })
  const authLimit = createRateLimit({ name: "cp-auth", windowMs: 60_000, max: deps.rateLimits.authMax, key: ipKey })

  const authHandlers = createControlPlaneAuthHandlers({ authService, shadowService })
  const workspace = createWorkspaceHandlers({ workspaceService })
  const shadow = createInvitationShadowHandlers({ shadowService })

  // Readiness probe
  app.get("/readyz", (_, res) => res.json({ status: "ok" }))

  // Global rate limit on all routes
  app.use(globalLimit)

  // Auth routes (auth-specific rate limit on login/callback)
  app.get("/api/auth/login", authLimit, authHandlers.login)
  app.all("/api/auth/callback", authLimit, authHandlers.callback)
  app.get("/api/auth/logout", authHandlers.logout)

  // Dev/test auth stub routes
  if (authService instanceof StubAuthService) {
    if (!allowDevAuthRoutes) {
      throw new Error("StubAuthService is active but dev auth routes are not allowed in this environment")
    }

    const authStub = createAuthStubHandlers({
      authStubService: authService,
      shadowService,
    })
    app.get("/test-auth-login", authStub.getLoginPage)
    app.post("/test-auth-login", authLimit, authStub.handleLogin)
    app.post("/api/dev/login", authStub.handleDevLogin)
  }

  app.get("/api/auth/me", auth, authHandlers.me)

  // Workspace routes
  app.get("/api/workspaces", auth, workspace.list)
  app.post("/api/workspaces", auth, workspace.create)
  app.get("/api/regions", workspace.listRegions)

  // Internal API (inter-service)
  app.get("/internal/workspaces/:workspaceId/region", internalAuth, workspace.getRegion)
  app.post("/internal/invitation-shadows", internalAuth, shadow.create)
  app.patch("/internal/invitation-shadows/:id", internalAuth, shadow.update)

  app.use(errorHandler)
}
