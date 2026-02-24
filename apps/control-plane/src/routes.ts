import type { Express } from "express"
import { createAuthMiddleware, errorHandler, type AuthService, StubAuthService } from "@threa/backend-common"
import { createControlPlaneAuthHandlers } from "./features/auth/handlers"
import { createWorkspaceHandlers } from "./features/workspaces/handlers"
import { createInvitationShadowHandlers } from "./features/invitation-shadows/handlers"
import { createInternalAuthMiddleware } from "./lib/internal-auth"
import { createAuthStubHandlers } from "./features/auth/stub-handlers"
import type { ControlPlaneWorkspaceService } from "./features/workspaces/service"
import type { InvitationShadowService } from "./features/invitation-shadows/service"
import type { RegionalClient } from "./lib/regional-client"
import type { Pool } from "pg"

interface Dependencies {
  pool: Pool
  authService: AuthService
  workspaceService: ControlPlaneWorkspaceService
  shadowService: InvitationShadowService
  regionalClient: RegionalClient
  internalApiKey: string
  availableRegions: string[]
  allowDevAuthRoutes: boolean
}

export function registerRoutes(app: Express, deps: Dependencies) {
  const {
    pool,
    authService,
    workspaceService,
    shadowService,
    regionalClient,
    internalApiKey,
    availableRegions,
    allowDevAuthRoutes,
  } = deps

  const auth = createAuthMiddleware({ authService })
  const internalAuth = createInternalAuthMiddleware(internalApiKey)

  const authHandlers = createControlPlaneAuthHandlers({ authService, regionalClient, pool })
  const workspace = createWorkspaceHandlers({ workspaceService, availableRegions })
  const shadow = createInvitationShadowHandlers({ shadowService })

  // Readiness probe
  app.get("/readyz", (_, res) => res.json({ status: "ok" }))

  // Auth routes
  app.get("/api/auth/login", authHandlers.login)
  app.all("/api/auth/callback", authHandlers.callback)
  app.get("/api/auth/logout", authHandlers.logout)

  // Dev/test auth stub routes
  if (authService instanceof StubAuthService) {
    if (!allowDevAuthRoutes) {
      throw new Error("StubAuthService is active but dev auth routes are not allowed in this environment")
    }

    const authStub = createAuthStubHandlers({
      authStubService: authService,
      regionalClient,
      pool,
    })
    app.get("/test-auth-login", authStub.getLoginPage)
    app.post("/test-auth-login", authStub.handleLogin)
    app.post("/api/dev/login", authStub.handleDevLogin)
  }

  app.get("/api/auth/me", auth, authHandlers.me)

  // Workspace routes
  app.get("/api/workspaces", auth, workspace.list)
  app.post("/api/workspaces", auth, workspace.create)
  app.get("/api/regions", workspace.listRegions)

  // Internal API (inter-service)
  app.post("/internal/invitation-shadows", internalAuth, shadow.create)
  app.patch("/internal/invitation-shadows/:id", internalAuth, shadow.update)

  app.use(errorHandler)
}
