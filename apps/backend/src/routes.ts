import type { Express } from "express"
import { createAuthMiddleware } from "./middleware/auth"
import { createWorkspaceMemberMiddleware } from "./middleware/workspace"
import { createAuthHandlers } from "./handlers/auth"
import { createWorkspaceHandlers } from "./handlers/workspace-handlers"
import { createStreamHandlers } from "./handlers/stream-handlers"
import { createMessageHandlers } from "./handlers/message-handlers"
import { compose } from "./lib/middleware"
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

  const auth = createAuthMiddleware({ authService, userService })
  const workspaceMember = createWorkspaceMemberMiddleware({ workspaceService })
  const authed = compose(auth, workspaceMember)

  const authHandlers = createAuthHandlers({ authService, userService })
  const workspace = createWorkspaceHandlers({ workspaceService })
  const stream = createStreamHandlers({ streamService, eventService })
  const message = createMessageHandlers({ eventService, streamService })

  app.get("/api/auth/login", authHandlers.login)
  app.all("/api/auth/callback", authHandlers.callback)
  app.get("/api/auth/logout", authHandlers.logout)

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

  app.get("/api/auth/me", auth, authHandlers.me)

  app.get("/api/workspaces", auth, workspace.list)
  app.post("/api/workspaces", auth, workspace.create)
  app.get("/api/workspaces/:workspaceId", authed, workspace.get)
  app.get("/api/workspaces/:workspaceId/members", authed, workspace.getMembers)

  app.get("/api/workspaces/:workspaceId/streams", authed, stream.list)
  app.post("/api/workspaces/:workspaceId/streams", authed, stream.create)
  app.get("/api/workspaces/:workspaceId/streams/:streamId", authed, stream.get)
  app.patch("/api/workspaces/:workspaceId/streams/:streamId/companion", authed, stream.updateCompanionMode)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/pin", authed, stream.pin)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/mute", authed, stream.mute)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/archive", authed, stream.archive)

  app.get("/api/workspaces/:workspaceId/streams/:streamId/events", authed, stream.listEvents)

  app.post("/api/workspaces/:workspaceId/messages", authed, message.create)
  app.patch("/api/workspaces/:workspaceId/messages/:messageId", authed, message.update)
  app.delete("/api/workspaces/:workspaceId/messages/:messageId", authed, message.delete)
  app.post("/api/workspaces/:workspaceId/messages/:messageId/reactions", authed, message.addReaction)
  app.delete("/api/workspaces/:workspaceId/messages/:messageId/reactions/:emoji", authed, message.removeReaction)
}
