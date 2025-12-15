import type { Express } from "express"
import { createAuthMiddleware } from "./middleware/auth"
import { createAuthHandlers } from "./handlers/auth"
import { createWorkspaceHandlers } from "./handlers/workspace-handlers"
import { createStreamHandlers } from "./handlers/stream-handlers"
import { createMessageHandlers } from "./handlers/message-handlers"
import type { AuthService } from "./services/auth-service"
import { StubAuthService } from "./services/auth-service.stub"
import type { UserService } from "./services/user-service"
import type { WorkspaceService } from "./services/workspace-service"
import type { StreamService } from "./services/stream-service"
import type { EventService } from "./services/event-service"

interface Dependencies {
  authService: AuthService
  userService: UserService
  workspaceService: WorkspaceService
  streamService: StreamService
  eventService: EventService
}

export function registerRoutes(app: Express, deps: Dependencies) {
  const { authService, userService, workspaceService, streamService, eventService } = deps

  const authMiddleware = createAuthMiddleware({ authService, userService })
  const auth = createAuthHandlers({ authService, userService })
  const workspace = createWorkspaceHandlers({ workspaceService })
  const stream = createStreamHandlers({ streamService, workspaceService, eventService })
  const message = createMessageHandlers({ eventService, streamService, workspaceService })

  // ===========================================================================
  // Auth routes (public)
  // ===========================================================================
  app.get("/api/auth/login", auth.login)
  app.all("/api/auth/callback", auth.callback)
  app.get("/api/auth/logout", auth.logout)

  // ===========================================================================
  // Dev-only login (only works with USE_STUB_AUTH=true)
  // ===========================================================================
  if (authService instanceof StubAuthService) {
    app.post("/api/dev/login", async (req, res) => {
      const { email, name } = req.body as { email?: string; name?: string }

      const { user, session } = await authService.devLogin(userService, { email, name })

      res.cookie("wos_session", session, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
      })

      res.json({ user })
    })
  }

  // ===========================================================================
  // Auth routes (protected)
  // ===========================================================================
  app.get("/api/auth/me", authMiddleware, auth.me)

  // ===========================================================================
  // Workspace routes
  // ===========================================================================
  app.get("/api/workspaces", authMiddleware, workspace.list)
  app.post("/api/workspaces", authMiddleware, workspace.create)
  app.get("/api/workspaces/:workspaceId", authMiddleware, workspace.get)
  app.get("/api/workspaces/:workspaceId/members", authMiddleware, workspace.getMembers)

  // ===========================================================================
  // Stream routes (all workspace-scoped)
  // ===========================================================================
  app.get("/api/workspaces/:workspaceId/streams", authMiddleware, stream.list)
  app.post("/api/workspaces/:workspaceId/streams", authMiddleware, stream.create)
  app.get("/api/workspaces/:workspaceId/streams/:streamId", authMiddleware, stream.get)
  app.patch("/api/workspaces/:workspaceId/streams/:streamId/companion", authMiddleware, stream.updateCompanionMode)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/pin", authMiddleware, stream.pin)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/mute", authMiddleware, stream.mute)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/archive", authMiddleware, stream.archive)

  // ===========================================================================
  // Events route (replaces messages listing)
  // ===========================================================================
  app.get("/api/workspaces/:workspaceId/streams/:streamId/events", authMiddleware, stream.listEvents)

  // ===========================================================================
  // Message routes (workspace-scoped, not stream-scoped)
  // ===========================================================================
  app.post("/api/workspaces/:workspaceId/messages", authMiddleware, message.create)
  app.patch("/api/workspaces/:workspaceId/messages/:messageId", authMiddleware, message.update)
  app.delete("/api/workspaces/:workspaceId/messages/:messageId", authMiddleware, message.delete)
  app.post("/api/workspaces/:workspaceId/messages/:messageId/reactions", authMiddleware, message.addReaction)
  app.delete("/api/workspaces/:workspaceId/messages/:messageId/reactions/:emoji", authMiddleware, message.removeReaction)
}
