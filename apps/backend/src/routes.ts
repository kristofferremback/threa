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
import { createUserPreferencesHandlers } from "./handlers/user-preferences-handlers"
import { createAIUsageHandlers } from "./handlers/ai-usage-handlers"
import { createAuthStubHandlers } from "./handlers/auth-stub-handlers"
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
import type { UserPreferencesService } from "./services/user-preferences-service"
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
  userPreferencesService: UserPreferencesService
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
    userPreferencesService,
    s3Config,
    commandRegistry,
  } = deps

  const auth = createAuthMiddleware({ authService, userService })
  const workspaceMember = createWorkspaceMemberMiddleware({ workspaceService })
  const upload = createUploadMiddleware({ s3Config })
  // Express natively chains handlers - spread array at usage sites
  const authed: RequestHandler[] = [auth, workspaceMember]

  const authHandlers = createAuthHandlers({ authService, userService })
  const workspace = createWorkspaceHandlers({
    workspaceService,
    streamService,
    userPreferencesService,
    commandRegistry,
  })
  const stream = createStreamHandlers({ streamService, eventService })
  const message = createMessageHandlers({ eventService, streamService })
  const attachment = createAttachmentHandlers({ attachmentService, streamService })
  const search = createSearchHandlers({ searchService })
  const emoji = createEmojiHandlers()
  const conversation = createConversationHandlers({ conversationService, streamService })
  const command = createCommandHandlers({ pool, commandRegistry, streamService })
  const preferences = createUserPreferencesHandlers({ userPreferencesService })
  const aiUsage = createAIUsageHandlers({ pool })

  app.get("/api/auth/login", authHandlers.login)
  app.all("/api/auth/callback", authHandlers.callback)
  app.get("/api/auth/logout", authHandlers.logout)

  if (authService instanceof StubAuthService) {
    const authStub = createAuthStubHandlers({
      authStubService: authService,
      userService,
      workspaceService,
      streamService,
    })

    app.get("/test-auth-login", authStub.getLoginPage)
    app.post("/test-auth-login", authStub.handleLogin)
    app.post("/api/dev/login", authStub.handleDevLogin)
    app.post("/api/dev/workspaces/:workspaceId/join", auth, authStub.handleWorkspaceJoin)
    app.post(
      "/api/dev/workspaces/:workspaceId/streams/:streamId/join",
      auth,
      workspaceMember,
      authStub.handleStreamJoin
    )
  }

  app.get("/api/auth/me", auth, authHandlers.me)

  app.get("/api/workspaces", auth, workspace.list)
  app.post("/api/workspaces", auth, workspace.create)
  app.get("/api/workspaces/:workspaceId", ...authed, workspace.get)
  app.get("/api/workspaces/:workspaceId/bootstrap", ...authed, workspace.bootstrap)
  app.get("/api/workspaces/:workspaceId/members", ...authed, workspace.getMembers)
  app.get("/api/workspaces/:workspaceId/emojis", ...authed, emoji.list)

  // User preferences
  app.get("/api/workspaces/:workspaceId/preferences", ...authed, preferences.get)
  app.patch("/api/workspaces/:workspaceId/preferences", ...authed, preferences.update)

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
  app.post("/api/workspaces/:workspaceId/streams/:streamId/unarchive", ...authed, stream.unarchive)

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

  // AI Usage and Budget
  app.get("/api/workspaces/:workspaceId/ai-usage", ...authed, aiUsage.getUsage)
  app.get("/api/workspaces/:workspaceId/ai-usage/recent", ...authed, aiUsage.getRecentUsage)
  app.get("/api/workspaces/:workspaceId/ai-budget", ...authed, aiUsage.getBudget)
  app.put("/api/workspaces/:workspaceId/ai-budget", ...authed, aiUsage.updateBudget)

  app.use(errorHandler)
}
