import type { Express, RequestHandler } from "express"
import { createAuthMiddleware } from "./middleware/auth"
import { createWorkspaceMemberMiddleware } from "./middleware/workspace"
import { createUploadMiddleware } from "./middleware/upload"
import { createAuthHandlers } from "./handlers/auth"
import { createWorkspaceHandlers } from "./handlers/workspace-handlers"
import { createStreamHandlers } from "./handlers/stream-handlers"
import { createMessageHandlers } from "./handlers/message-handlers"
import { createAttachmentHandlers } from "./handlers/attachment-handlers"
import { createSearchHandlers } from "./handlers/search-handlers"
import { createEmojiHandlers } from "./handlers/emoji-handlers"
import { createConversationHandlers } from "./handlers/conversation-handlers"
import { createCommandHandlers } from "./handlers/command-handlers"
import { errorHandler } from "./lib/error-handler"
import type { AuthService } from "./services/auth-service"
import { StubAuthService } from "./services/auth-service.stub"
import type { UserService } from "./services/user-service"
import type { WorkspaceService } from "./services/workspace-service"
import type { StreamService } from "./services/stream-service"
import type { EventService } from "./services/event-service"
import type { AttachmentService } from "./services/attachment-service"
import type { SearchService } from "./services/search-service"
import type { ConversationService } from "./services/conversation-service"
import type { S3Config } from "./lib/env"
import type { CommandRegistry } from "./commands"
import type { Pool } from "pg"

interface Dependencies {
  pool: Pool
  authService: AuthService
  userService: UserService
  workspaceService: WorkspaceService
  streamService: StreamService
  eventService: EventService
  attachmentService: AttachmentService
  searchService: SearchService
  conversationService: ConversationService
  s3Config: S3Config
  commandRegistry: CommandRegistry
}

export function registerRoutes(app: Express, deps: Dependencies) {
  const {
    pool,
    authService,
    userService,
    workspaceService,
    streamService,
    eventService,
    attachmentService,
    searchService,
    conversationService,
    s3Config,
    commandRegistry,
  } = deps

  const auth = createAuthMiddleware({ authService, userService })
  const workspaceMember = createWorkspaceMemberMiddleware({ workspaceService })
  const upload = createUploadMiddleware({ s3Config })
  // Express natively chains handlers - spread array at usage sites
  const authed: RequestHandler[] = [auth, workspaceMember]

  const authHandlers = createAuthHandlers({ authService, userService })
  const workspace = createWorkspaceHandlers({ workspaceService, streamService, commandRegistry })
  const stream = createStreamHandlers({ streamService, eventService })
  const message = createMessageHandlers({ eventService, streamService })
  const attachment = createAttachmentHandlers({ attachmentService, streamService })
  const search = createSearchHandlers({ searchService })
  const emoji = createEmojiHandlers()
  const conversation = createConversationHandlers({ conversationService, streamService })
  const command = createCommandHandlers({ pool, commandRegistry, streamService })

  app.get("/api/auth/login", authHandlers.login)
  app.all("/api/auth/callback", authHandlers.callback)
  app.get("/api/auth/logout", authHandlers.logout)

  if (authService instanceof StubAuthService) {
    // Fake login page for browser-based testing (mirrors WorkOS AuthKit flow)
    app.get("/test-auth-login", (req, res) => {
      const state = (req.query.state as string) || ""
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Login - Threa</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #fafafa; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { background: #171717; border: 1px solid #262626; border-radius: 12px; padding: 32px; width: 100%; max-width: 400px; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #a3a3a3; margin-bottom: 24px; }
    .preset-buttons { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
    .preset-btn { background: #262626; border: 1px solid #404040; color: #fafafa; padding: 12px 16px; border-radius: 8px; cursor: pointer; text-align: left; transition: background 0.15s; }
    .preset-btn:hover { background: #303030; }
    .preset-btn .name { font-weight: 500; }
    .preset-btn .email { color: #a3a3a3; font-size: 14px; }
    .divider { display: flex; align-items: center; gap: 16px; margin: 24px 0; color: #525252; font-size: 14px; }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #404040; }
    form { display: flex; flex-direction: column; gap: 16px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: #a3a3a3; }
    input { background: #262626; border: 1px solid #404040; color: #fafafa; padding: 10px 12px; border-radius: 6px; font-size: 16px; }
    input:focus { outline: none; border-color: #c9a227; }
    button[type="submit"] { background: #c9a227; color: #0a0a0a; border: none; padding: 12px 16px; border-radius: 8px; font-size: 16px; font-weight: 500; cursor: pointer; transition: background 0.15s; }
    button[type="submit"]:hover { background: #d4af37; }
    .warning { background: #422006; border: 1px solid #713f12; color: #fcd34d; padding: 12px; border-radius: 8px; font-size: 14px; margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Test Login</h1>
    <p class="subtitle">Development authentication</p>
    <div class="warning">⚠️ Stub auth enabled. This page only appears in development.</div>
    <div class="preset-buttons">
      <button type="button" class="preset-btn" onclick="loginAs('alice@example.com', 'Alice Anderson')">
        <div class="name">Alice Anderson</div>
        <div class="email">alice@example.com</div>
      </button>
      <button type="button" class="preset-btn" onclick="loginAs('bob@example.com', 'Bob Builder')">
        <div class="name">Bob Builder</div>
        <div class="email">bob@example.com</div>
      </button>
    </div>
    <div class="divider">or enter custom credentials</div>
    <form method="POST" action="/test-auth-login">
      <input type="hidden" name="state" value="${state}" />
      <label>
        Email
        <input type="email" name="email" value="test@example.com" required />
      </label>
      <label>
        Name
        <input type="text" name="name" value="Test User" required />
      </label>
      <button type="submit">Sign In</button>
    </form>
  </div>
  <script>
    function loginAs(email, name) {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/test-auth-login';
      form.innerHTML = '<input type="hidden" name="state" value="${state}" />' +
        '<input type="hidden" name="email" value="' + email + '" />' +
        '<input type="hidden" name="name" value="' + name + '" />';
      document.body.appendChild(form);
      form.submit();
    }
  </script>
</body>
</html>`)
    })

    // Handle fake login form submission
    app.post("/test-auth-login", async (req, res) => {
      const { email, name, state } = req.body as { email?: string; name?: string; state?: string }

      const { session } = await authService.devLogin(userService, { email, name })

      res.cookie("wos_session", session, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
      })

      const redirectTo = state ? Buffer.from(state, "base64").toString("utf-8") : "/"
      res.redirect(redirectTo)
    })

    // JSON API for programmatic test login (existing endpoint)
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

    // Dev endpoint for joining workspaces (for testing multi-user scenarios)
    app.post("/api/dev/workspaces/:workspaceId/join", auth, async (req, res) => {
      const userId = req.userId!
      const { workspaceId } = req.params
      const { role } = req.body as { role?: "member" | "admin" }

      const member = await workspaceService.addMember(workspaceId, userId, role || "member")
      res.json({ member })
    })

    // Dev endpoint for joining streams (for testing membership)
    app.post("/api/dev/workspaces/:workspaceId/streams/:streamId/join", auth, workspaceMember, async (req, res) => {
      const userId = req.userId!
      const { streamId } = req.params

      const member = await streamService.addMember(streamId, userId)
      res.json({ member })
    })
  }

  app.get("/api/auth/me", auth, authHandlers.me)

  app.get("/api/workspaces", auth, workspace.list)
  app.post("/api/workspaces", auth, workspace.create)
  app.get("/api/workspaces/:workspaceId", ...authed, workspace.get)
  app.get("/api/workspaces/:workspaceId/bootstrap", ...authed, workspace.bootstrap)
  app.get("/api/workspaces/:workspaceId/members", ...authed, workspace.getMembers)
  app.get("/api/workspaces/:workspaceId/emojis", ...authed, emoji.list)

  app.get("/api/workspaces/:workspaceId/streams", ...authed, stream.list)
  app.post("/api/workspaces/:workspaceId/streams", ...authed, stream.create)
  app.post("/api/workspaces/:workspaceId/streams/read-all", ...authed, workspace.markAllAsRead)
  app.get("/api/workspaces/:workspaceId/streams/:streamId", ...authed, stream.get)
  app.get("/api/workspaces/:workspaceId/streams/:streamId/bootstrap", ...authed, stream.bootstrap)
  app.patch("/api/workspaces/:workspaceId/streams/:streamId/companion", ...authed, stream.updateCompanionMode)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/pin", ...authed, stream.pin)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/mute", ...authed, stream.mute)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/read", ...authed, stream.markAsRead)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/archive", ...authed, stream.archive)

  app.get("/api/workspaces/:workspaceId/streams/:streamId/events", ...authed, stream.listEvents)

  // Search
  app.post("/api/workspaces/:workspaceId/search", ...authed, search.search)

  app.post("/api/workspaces/:workspaceId/messages", ...authed, message.create)
  app.patch("/api/workspaces/:workspaceId/messages/:messageId", ...authed, message.update)
  app.delete("/api/workspaces/:workspaceId/messages/:messageId", ...authed, message.delete)
  app.post("/api/workspaces/:workspaceId/messages/:messageId/reactions", ...authed, message.addReaction)
  app.delete("/api/workspaces/:workspaceId/messages/:messageId/reactions/:emoji", ...authed, message.removeReaction)

  // Attachments (workspace-scoped upload, stream assigned on message creation)
  app.post("/api/workspaces/:workspaceId/attachments", ...authed, upload, attachment.upload)
  app.get("/api/workspaces/:workspaceId/attachments/:attachmentId/url", ...authed, attachment.getDownloadUrl)
  app.delete("/api/workspaces/:workspaceId/attachments/:attachmentId", ...authed, attachment.delete)

  // Conversations
  app.get("/api/workspaces/:workspaceId/streams/:streamId/conversations", ...authed, conversation.listByStream)
  app.get("/api/workspaces/:workspaceId/conversations/:conversationId", ...authed, conversation.getById)
  app.get("/api/workspaces/:workspaceId/conversations/:conversationId/messages", ...authed, conversation.getMessages)

  // Commands
  app.post("/api/workspaces/:workspaceId/commands/dispatch", ...authed, command.dispatch)
  app.get("/api/workspaces/:workspaceId/commands", ...authed, command.list)

  app.use(errorHandler)
}
