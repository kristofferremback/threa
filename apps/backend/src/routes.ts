import type { Express } from "express"
import { createAuthMiddleware } from "./middleware/auth"
import { createAuthHandlers } from "./handlers/auth"
import type { AuthService } from "./services/auth-service"
import type { UserService } from "./services/user-service"

interface Dependencies {
  authService: AuthService
  userService: UserService
}

export function registerRoutes(app: Express, deps: Dependencies) {
  const { authService, userService } = deps

  const authMiddleware = createAuthMiddleware({ authService, userService })
  const auth = createAuthHandlers({ authService, userService })

  // ===========================================================================
  // Auth routes (public)
  // ===========================================================================
  app.get("/api/auth/login", auth.login)
  app.all("/api/auth/callback", auth.callback)
  app.get("/api/auth/logout", auth.logout)

  // ===========================================================================
  // Auth routes (protected)
  // ===========================================================================
  app.get("/api/auth/me", authMiddleware, auth.me)

  // ===========================================================================
  // Protected routes (add more sections as needed)
  // ===========================================================================
  // app.get("/api/workspaces", authMiddleware, workspace.list)
}
