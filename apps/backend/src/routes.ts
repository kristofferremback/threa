import type { Express } from "express"
import { createAuthMiddleware } from "./middleware/auth"
import { createAuthHandlers } from "./handlers/auth"
import { createWorkspaceHandlers } from "./handlers/workspace-handlers"
import { createStreamHandlers } from "./handlers/stream-handlers"
import { createMessageHandlers } from "./handlers/message-handlers"
import type { AuthService } from "./services/auth-service"
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
  const stream = createStreamHandlers({ streamService, workspaceService })
  const message = createMessageHandlers({ eventService, streamService })

  // ===========================================================================
  // Auth routes (public)
  // ===========================================================================
  app.get("/api/auth/login", auth.login)
  app.all("/api/auth/callback", auth.callback)
  app.get("/api/auth/logout", auth.logout)

  // ===========================================================================
  // Dev-only login (only works with USE_STUB_AUTH=true)
  // ===========================================================================
  if ("registerTestUser" in authService) {
    app.post("/api/dev/login", async (req, res) => {
      const stubAuth = authService as { registerTestUser: (user: { id: string; email: string; firstName?: string }) => string }
      const { email, name } = req.body as { email?: string; name?: string }

      const testEmail = email || "test@example.com"
      const testName = name || "Test User"

      // Ensure user exists in DB
      const user = await userService.ensureUser({
        email: testEmail,
        name: testName,
      })

      // Register with stub auth and get session
      const session = stubAuth.registerTestUser({
        id: user.id,
        email: user.email,
        firstName: testName,
      })

      res.cookie("wos_session", session, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
      })

      res.json({ user: { id: user.id, email: user.email, name: user.name } })
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
  // Stream routes
  // ===========================================================================
  app.get("/api/workspaces/:workspaceId/scratchpads", authMiddleware, stream.listScratchpads)
  app.post("/api/workspaces/:workspaceId/scratchpads", authMiddleware, stream.createScratchpad)
  app.post("/api/workspaces/:workspaceId/channels", authMiddleware, stream.createChannel)
  app.get("/api/streams/:streamId", authMiddleware, stream.get)
  app.patch("/api/streams/:streamId/companion", authMiddleware, stream.updateCompanionMode)
  app.post("/api/streams/:streamId/pin", authMiddleware, stream.pin)
  app.post("/api/streams/:streamId/mute", authMiddleware, stream.mute)
  app.post("/api/streams/:streamId/archive", authMiddleware, stream.archive)

  // ===========================================================================
  // Message routes
  // ===========================================================================
  app.get("/api/streams/:streamId/messages", authMiddleware, message.list)
  app.post("/api/streams/:streamId/messages", authMiddleware, message.create)
  app.patch("/api/messages/:messageId", authMiddleware, message.update)
  app.delete("/api/messages/:messageId", authMiddleware, message.delete)
  app.post("/api/messages/:messageId/reactions", authMiddleware, message.addReaction)
  app.delete("/api/messages/:messageId/reactions/:emoji", authMiddleware, message.removeReaction)
}
