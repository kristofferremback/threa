import type { Express, RequestHandler } from "express"
import { createAuthMiddleware } from "./auth/middleware"
import { createWorkspaceMemberMiddleware, requireRole } from "./middleware/workspace"
import { createUploadMiddleware } from "./middleware/upload"
import { authRateLimit, aiRateLimit, standardRateLimit, relaxedRateLimit } from "./middleware/rate-limit"
import { createAuthHandlers } from "./auth/handlers"
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
import { createDebugHandlers } from "./handlers/debug-handlers"
import { createAuthStubHandlers } from "./auth/auth-stub-handlers"
import { createAgentSessionHandlers } from "./handlers/agent-session-handlers"
import { errorHandler } from "./lib/error-handler"
import type { AuthService } from "./auth/auth-service"
import { StubAuthService } from "./auth/auth-service.stub"
import type { UserService } from "./auth/user-service"
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
import type { PoolMonitor } from "./lib/pool-monitor"

interface Dependencies {
  pool: Pool
  poolMonitor: PoolMonitor
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
    poolMonitor,
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
  const workspaceMember = createWorkspaceMemberMiddleware({ pool })
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
  const message = createMessageHandlers({ pool, eventService, streamService, commandRegistry })
  const attachment = createAttachmentHandlers({ attachmentService, streamService })
  const search = createSearchHandlers({ searchService })
  const emoji = createEmojiHandlers()
  const conversation = createConversationHandlers({ conversationService, streamService })
  const command = createCommandHandlers({ pool, commandRegistry, streamService })
  const preferences = createUserPreferencesHandlers({ userPreferencesService })
  const aiUsage = createAIUsageHandlers({ pool })
  const debug = createDebugHandlers({ pool, poolMonitor })
  const agentSession = createAgentSessionHandlers({ pool })

  // Health check endpoint - no auth required
  app.get("/health", debug.health)

  // Debug endpoint - only available outside production
  if (process.env.NODE_ENV !== "production") {
    app.get("/debug/pool", debug.poolState)
  }

  app.get("/api/auth/login", authRateLimit, authHandlers.login)
  app.all("/api/auth/callback", authRateLimit, authHandlers.callback)
  app.get("/api/auth/logout", authRateLimit, authHandlers.logout)

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

  app.get("/api/auth/me", relaxedRateLimit, auth, authHandlers.me)

  app.get("/api/workspaces", relaxedRateLimit, auth, workspace.list)
  app.post("/api/workspaces", standardRateLimit, auth, workspace.create)
  app.get("/api/workspaces/:workspaceId", relaxedRateLimit, ...authed, workspace.get)
  app.get("/api/workspaces/:workspaceId/bootstrap", relaxedRateLimit, ...authed, workspace.bootstrap)
  app.get("/api/workspaces/:workspaceId/members", relaxedRateLimit, ...authed, workspace.getMembers)
  app.get("/api/workspaces/:workspaceId/emojis", relaxedRateLimit, ...authed, emoji.list)

  // User preferences
  app.get("/api/workspaces/:workspaceId/preferences", relaxedRateLimit, ...authed, preferences.get)
  app.patch("/api/workspaces/:workspaceId/preferences", standardRateLimit, ...authed, preferences.update)

  app.get("/api/workspaces/:workspaceId/streams", relaxedRateLimit, ...authed, stream.list)
  app.post("/api/workspaces/:workspaceId/streams", standardRateLimit, ...authed, stream.create)
  app.post("/api/workspaces/:workspaceId/streams/read-all", standardRateLimit, ...authed, workspace.markAllAsRead)
  app.get("/api/workspaces/:workspaceId/streams/:streamId", relaxedRateLimit, ...authed, stream.get)
  app.patch("/api/workspaces/:workspaceId/streams/:streamId", standardRateLimit, ...authed, stream.update)
  app.get("/api/workspaces/:workspaceId/streams/:streamId/bootstrap", relaxedRateLimit, ...authed, stream.bootstrap)
  app.patch(
    "/api/workspaces/:workspaceId/streams/:streamId/companion",
    standardRateLimit,
    ...authed,
    stream.updateCompanionMode
  )
  app.post("/api/workspaces/:workspaceId/streams/:streamId/pin", standardRateLimit, ...authed, stream.pin)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/mute", standardRateLimit, ...authed, stream.mute)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/read", standardRateLimit, ...authed, stream.markAsRead)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/archive", standardRateLimit, ...authed, stream.archive)
  app.post("/api/workspaces/:workspaceId/streams/:streamId/unarchive", standardRateLimit, ...authed, stream.unarchive)

  app.get("/api/workspaces/:workspaceId/streams/:streamId/events", relaxedRateLimit, ...authed, stream.listEvents)

  // Search (triggers AI embeddings)
  app.post("/api/workspaces/:workspaceId/search", aiRateLimit, ...authed, search.search)

  // Messages (creation triggers companion AI)
  app.post("/api/workspaces/:workspaceId/messages", aiRateLimit, ...authed, message.create)
  app.patch("/api/workspaces/:workspaceId/messages/:messageId", standardRateLimit, ...authed, message.update)
  app.delete("/api/workspaces/:workspaceId/messages/:messageId", standardRateLimit, ...authed, message.delete)
  app.post(
    "/api/workspaces/:workspaceId/messages/:messageId/reactions",
    standardRateLimit,
    ...authed,
    message.addReaction
  )
  app.delete(
    "/api/workspaces/:workspaceId/messages/:messageId/reactions/:emoji",
    standardRateLimit,
    ...authed,
    message.removeReaction
  )

  // Attachments (workspace-scoped upload, stream assigned on message creation)
  app.post("/api/workspaces/:workspaceId/attachments", standardRateLimit, ...authed, upload, attachment.upload)
  app.get(
    "/api/workspaces/:workspaceId/attachments/:attachmentId/url",
    relaxedRateLimit,
    ...authed,
    attachment.getDownloadUrl
  )
  app.delete("/api/workspaces/:workspaceId/attachments/:attachmentId", standardRateLimit, ...authed, attachment.delete)

  // Conversations
  app.get(
    "/api/workspaces/:workspaceId/streams/:streamId/conversations",
    relaxedRateLimit,
    ...authed,
    conversation.listByStream
  )
  app.get(
    "/api/workspaces/:workspaceId/conversations/:conversationId",
    relaxedRateLimit,
    ...authed,
    conversation.getById
  )
  app.get(
    "/api/workspaces/:workspaceId/conversations/:conversationId/messages",
    relaxedRateLimit,
    ...authed,
    conversation.getMessages
  )

  // Commands (triggers AI)
  app.post("/api/workspaces/:workspaceId/commands/dispatch", aiRateLimit, ...authed, command.dispatch)
  app.get("/api/workspaces/:workspaceId/commands", relaxedRateLimit, ...authed, command.list)

  // AI Usage and Budget
  app.get("/api/workspaces/:workspaceId/ai-usage", relaxedRateLimit, ...authed, aiUsage.getUsage)
  app.get("/api/workspaces/:workspaceId/ai-usage/recent", relaxedRateLimit, ...authed, aiUsage.getRecentUsage)
  app.get("/api/workspaces/:workspaceId/ai-budget", relaxedRateLimit, ...authed, aiUsage.getBudget)
  app.put(
    "/api/workspaces/:workspaceId/ai-budget",
    standardRateLimit,
    ...authed,
    requireRole("admin"),
    aiUsage.updateBudget
  )

  // Agent Sessions (trace viewing)
  app.get(
    "/api/workspaces/:workspaceId/agent-sessions/:sessionId",
    relaxedRateLimit,
    ...authed,
    agentSession.getSession
  )

  // Prometheus metrics endpoint (unauthenticated for scraping)
  app.get("/metrics", debug.metrics)

  app.use(errorHandler)
}
