import express from "express"
import cookieParser from "cookie-parser"
import path from "path"
import { fileURLToPath } from "url"
import http from "http"
import type { Server as HTTPServer } from "http"
import pinoHttp from "pino-http"
import { createAuthMiddleware, createAuthHandlers } from "./routes/auth-routes"
import { createStreamHandlers } from "./routes/stream-routes"
import { createInvitationHandlers } from "./routes/invitation-routes"
import { createSearchHandlers } from "./routes/search-routes"
import { createMemoHandlers } from "./routes/memo-routes"
import { createPersonaHandlers } from "./routes/persona-routes"
import { createSettingsHandlers } from "./routes/settings-routes"
import { SearchService } from "./services/search-service"
import { setupStreamWebSocket } from "./websockets/stream-socket"
import {
  isProduction,
  PORT,
  DATABASE_URL,
  USE_STUB_AUTH,
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_FAILURES_TO_UNHEALTHY,
} from "./config"
import { logger } from "./lib/logger"
import { randomUUID } from "crypto"
import { runMigrations } from "./lib/migrations"
import { createDatabasePool } from "./lib/db"
import { Pool } from "pg"
import { WorkosAuthService, type AuthService } from "./services/auth-service"
import { StubAuthService } from "./services/stub-auth-service"
import { UserService } from "./services/user-service"
import { WorkspaceService } from "./services/workspace-service"
import { StreamService } from "./services/stream-service"
import { validateEnv } from "./lib/env-validator"
import { createErrorHandler } from "./middleware/error-handler"
import { createSocketIORedisClients, type RedisClient } from "./lib/redis"
import { OutboxListener } from "./lib/outbox-listener"
import { esMain } from "./lib/is-main"
import { promisify } from "util"
import { attempt } from "./lib/attempt"
import { startWorkers, stopWorkers } from "./workers"
import { initLangfuse, shutdownLangfuse } from "./lib/langfuse"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// =============================================================================
// Shutdown Coordinator
// =============================================================================

interface ShutdownConfig {
  healthCheckIntervalMs: number
  failedChecksToUnhealthy: number
}

const DEFAULT_SHUTDOWN_CONFIG: ShutdownConfig = {
  healthCheckIntervalMs: 10_000,
  failedChecksToUnhealthy: 2,
}

class ShutdownCoordinator {
  private _isShuttingDown = false
  private _shutdownStartedAt: Date | null = null
  private config: ShutdownConfig

  constructor(config: Partial<ShutdownConfig> = {}) {
    this.config = { ...DEFAULT_SHUTDOWN_CONFIG, ...config }
  }

  get isShuttingDown(): boolean {
    return this._isShuttingDown
  }

  get shutdownStartedAt(): Date | null {
    return this._shutdownStartedAt
  }

  get lbDrainTimeMs(): number {
    return this.config.healthCheckIntervalMs * this.config.failedChecksToUnhealthy
  }

  startShutdown(): void {
    if (this._isShuttingDown) return
    this._isShuttingDown = true
    this._shutdownStartedAt = new Date()
    logger.info({ lbDrainTimeMs: this.lbDrainTimeMs }, "Shutdown initiated, waiting for LB to drain")
  }

  async waitForLbDrain(): Promise<void> {
    if (!this._isShuttingDown) return
    logger.info({ waitMs: this.lbDrainTimeMs }, "Waiting for load balancer to drain connections")
    await new Promise((resolve) => setTimeout(resolve, this.lbDrainTimeMs))
    logger.info("LB drain period complete")
  }
}

export const shutdownCoordinator = new ShutdownCoordinator({
  healthCheckIntervalMs: HEALTH_CHECK_INTERVAL_MS,
  failedChecksToUnhealthy: HEALTH_CHECK_FAILURES_TO_UNHEALTHY,
})

export interface AppContext {
  app: express.Application
  server: HTTPServer
  pool: Pool
  authService: AuthService
  userService: UserService
  streamService: StreamService
  workspaceService: WorkspaceService
  redisPubClient: RedisClient
  redisSubClient: RedisClient
  outboxListener: OutboxListener

  close(): Promise<void>
}

function gracefulShutdown({
  context,
  preShutdown = () => Promise.resolve(),
  onShutdown = () => Promise.resolve(),
  timeoutMs = 30_000,
}: {
  context: AppContext
  preShutdown?: () => Promise<void> | void
  onShutdown?: () => Promise<void> | void
  timeoutMs: number
}): void {
  const shutdown = async () => {
    if (shutdownCoordinator.isShuttingDown) return
    shutdownCoordinator.startShutdown()

    const timeout = setTimeout(() => {
      logger.error({ timeoutMs }, "Server shutdown timed out, forcing exit")
      process.exit(1)
    }, timeoutMs)

    try {
      logger.info("Shutting down server gracefully")
      await shutdownCoordinator.waitForLbDrain()
      await attempt(() => preShutdown())
      await attempt(() => context.close())
      await attempt(() => onShutdown())
      logger.info("Server shut down gracefully")
    } finally {
      clearTimeout(timeout)
    }
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

export async function createApp(): Promise<AppContext> {
  const app = express()

  app.use(express.json())
  app.use(cookieParser())

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === "/health",
      },
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) return "error"
        if (res.statusCode >= 400) return "warn"
        return "silent"
      },
      genReqId: (req) => (req.headers["x-request-id"] as string) || randomUUID(),
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
          "req.headers['x-api-key']",
        ],
        censor: "[REDACTED]",
      },
      customSuccessMessage: (req, res) => {
        return `${req.method} ${req.url} ${res.statusCode}`
      },
      customErrorMessage: (req, res, err) => {
        return `${req.method} ${req.url} ${res.statusCode} - ${err?.message || "Error"}`
      },
    }),
  )

  app.get("/health", (_, res) => {
    if (shutdownCoordinator.isShuttingDown) {
      return res.status(503).json({ status: "shutting_down", message: "Server is shutting down" })
    }
    return res.json({ status: "ok", message: "Threa API" })
  })

  if (!isProduction) {
    app.get("/", (_, res) => res.redirect("http://localhost:3000"))
  }

  const pool = createDatabasePool()

  const authService: AuthService = USE_STUB_AUTH ? new StubAuthService() : new WorkosAuthService()

  if (USE_STUB_AUTH) {
    logger.warn("Using stub auth service - NOT FOR PRODUCTION")
  }

  const streamService = new StreamService(pool)
  const userService = new UserService(pool)
  const workspaceService = new WorkspaceService(pool)
  const searchService = new SearchService(pool)
  const outboxListener = new OutboxListener(pool, DATABASE_URL)

  const { pubClient: redisPubClient, subClient: redisSubClient } = await createSocketIORedisClients()

  // Create middleware
  const authMiddleware = createAuthMiddleware(authService)

  // Create handlers
  const auth = createAuthHandlers({ authService })
  const streams = createStreamHandlers({ streamService, workspaceService, pool })
  const invitations = createInvitationHandlers({ workspaceService })
  const search = createSearchHandlers({ searchService })
  const memos = createMemoHandlers({ pool })
  const personas = createPersonaHandlers({ pool })
  const settings = createSettingsHandlers({ pool })

  // Test endpoint for registering users in stub auth mode
  if (USE_STUB_AUTH && authService instanceof StubAuthService) {
    app.post("/api/test/register-user", async (req, res) => {
      const { id, email, firstName, lastName } = req.body
      if (!id || !email) {
        return res.status(400).json({ error: "id and email required" })
      }

      await userService.ensureUser({
        id,
        email,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
      })

      const sessionToken = authService.registerTestUser({ id, email, firstName, lastName })
      return res.json({ sessionToken })
    })
  }

  // ==========================================================================
  // Auth routes (no auth required except /me)
  // ==========================================================================
  app.get("/api/auth/login", auth.login)
  app.all("/api/auth/callback", auth.callback)
  app.get("/api/auth/logout", auth.logout)
  app.get("/api/auth/me", authMiddleware, auth.me)

  // ==========================================================================
  // Invitation routes (public)
  // ==========================================================================
  app.get("/api/invite/:token", invitations.getInvitation)
  app.post("/api/invite/:token/accept", authMiddleware, invitations.acceptInvitation)

  // ==========================================================================
  // Workspace routes (auth required)
  // ==========================================================================
  app.post("/api/workspace", authMiddleware, streams.createWorkspace)
  app.get("/api/workspace/default/bootstrap", authMiddleware, streams.getDefaultBootstrap)
  app.get("/api/workspace/:workspaceId/bootstrap", authMiddleware, streams.getBootstrap)

  // ==========================================================================
  // Stream routes (auth required)
  // ==========================================================================
  app.get("/api/workspace/:workspaceId/streams/check-slug", authMiddleware, streams.checkSlug)
  app.get("/api/workspace/:workspaceId/streams/browse", authMiddleware, streams.browseStreams)
  app.get("/api/workspace/:workspaceId/streams/by-event/:eventId/thread", authMiddleware, streams.getThreadByEvent)
  app.get("/api/workspace/:workspaceId/streams/:streamId", authMiddleware, streams.getStream)
  app.get("/api/workspace/:workspaceId/streams/:streamId/ancestors", authMiddleware, streams.getAncestors)
  app.post("/api/workspace/:workspaceId/streams", authMiddleware, streams.createStream)
  app.post("/api/workspace/:workspaceId/thinking-spaces", authMiddleware, streams.createThinkingSpace)
  app.patch("/api/workspace/:workspaceId/streams/:streamId", authMiddleware, streams.updateStream)
  app.delete("/api/workspace/:workspaceId/streams/:streamId", authMiddleware, streams.archiveStream)

  // Stream membership
  app.post("/api/workspace/:workspaceId/streams/:streamId/join", authMiddleware, streams.joinStream)
  app.post("/api/workspace/:workspaceId/streams/:streamId/leave", authMiddleware, streams.leaveStream)
  app.post("/api/workspace/:workspaceId/streams/:streamId/pin", authMiddleware, streams.pinStream)
  app.post("/api/workspace/:workspaceId/streams/:streamId/unpin", authMiddleware, streams.unpinStream)
  app.get("/api/workspace/:workspaceId/streams/:streamId/members", authMiddleware, streams.getMembers)
  app.post("/api/workspace/:workspaceId/streams/:streamId/members", authMiddleware, streams.addMember)
  app.delete("/api/workspace/:workspaceId/streams/:streamId/members/:memberId", authMiddleware, streams.removeMember)

  // Stream read state
  app.post("/api/workspace/:workspaceId/streams/:streamId/read", authMiddleware, streams.markAsRead)
  app.post("/api/workspace/:workspaceId/streams/:streamId/unread", authMiddleware, streams.markAsUnread)

  // Thread operations
  app.post("/api/workspace/:workspaceId/streams/:streamId/thread", authMiddleware, streams.createThread)
  app.get(
    "/api/workspace/:workspaceId/streams/:streamId/events/:eventId/thread",
    authMiddleware,
    streams.getThreadForEvent,
  )
  app.post("/api/workspace/:workspaceId/streams/:streamId/promote", authMiddleware, streams.promoteStream)
  app.post("/api/workspace/:workspaceId/streams/:streamId/share", authMiddleware, streams.shareEvent)

  // ==========================================================================
  // Event routes (auth required)
  // ==========================================================================
  app.get("/api/workspace/:workspaceId/streams/:streamId/events", authMiddleware, streams.getEvents)
  app.post("/api/workspace/:workspaceId/streams/:streamId/events", authMiddleware, streams.createEvent)
  app.patch("/api/workspace/:workspaceId/streams/:streamId/events/:eventId", authMiddleware, streams.editEvent)
  app.delete("/api/workspace/:workspaceId/streams/:streamId/events/:eventId", authMiddleware, streams.deleteEvent)
  app.get(
    "/api/workspace/:workspaceId/streams/:streamId/events/:eventId/revisions",
    authMiddleware,
    streams.getEventRevisions,
  )
  app.post("/api/workspace/:workspaceId/streams/:streamId/events/:eventId/reply", authMiddleware, streams.replyToEvent)
  app.get("/api/workspace/:workspaceId/events/:eventId", authMiddleware, streams.getEventDetails)

  // ==========================================================================
  // Search routes (auth required)
  // ==========================================================================
  app.post("/api/workspace/:workspaceId/search", authMiddleware, search.search)
  app.get("/api/workspace/:workspaceId/search", authMiddleware, search.searchGet)
  app.get("/api/workspace/:workspaceId/search/suggestions", authMiddleware, search.getSuggestions)

  // ==========================================================================
  // Notification routes (auth required)
  // ==========================================================================
  app.get("/api/workspace/:workspaceId/notifications/count", authMiddleware, streams.getNotificationCount)
  app.get("/api/workspace/:workspaceId/notifications", authMiddleware, streams.getNotifications)
  app.post(
    "/api/workspace/:workspaceId/notifications/:notificationId/read",
    authMiddleware,
    streams.markNotificationAsRead,
  )
  app.post("/api/workspace/:workspaceId/notifications/read-all", authMiddleware, streams.markAllNotificationsAsRead)

  // ==========================================================================
  // Profile routes (auth required)
  // ==========================================================================
  app.get("/api/workspace/:workspaceId/profile", authMiddleware, streams.getProfile)
  app.patch("/api/workspace/:workspaceId/profile", authMiddleware, streams.updateProfile)

  // ==========================================================================
  // Workspace invitation routes (auth required)
  // ==========================================================================
  app.post("/api/workspace/:workspaceId/invitations", authMiddleware, streams.createInvitation)
  app.get("/api/workspace/:workspaceId/invitations", authMiddleware, streams.getInvitations)
  app.delete("/api/workspace/:workspaceId/invitations/:invitationId", authMiddleware, streams.revokeInvitation)

  // ==========================================================================
  // Memo routes (auth required)
  // ==========================================================================
  app.get("/api/workspace/:workspaceId/memos", authMiddleware, memos.listMemos)
  app.get("/api/workspace/:workspaceId/memos/:memoId", authMiddleware, memos.getMemo)
  app.post("/api/workspace/:workspaceId/memos", authMiddleware, memos.createMemo)
  app.patch("/api/workspace/:workspaceId/memos/:memoId", authMiddleware, memos.updateMemo)
  app.delete("/api/workspace/:workspaceId/memos/:memoId", authMiddleware, memos.archiveMemo)
  app.get("/api/workspace/:workspaceId/experts", authMiddleware, memos.getExperts)

  // ==========================================================================
  // Persona routes (auth required)
  // ==========================================================================
  app.get("/api/workspace/:workspaceId/personas", authMiddleware, personas.listPersonas)
  app.get("/api/workspace/:workspaceId/personas/:personaId", authMiddleware, personas.getPersona)
  app.post("/api/workspace/:workspaceId/personas", authMiddleware, personas.createPersona)
  app.patch("/api/workspace/:workspaceId/personas/:personaId", authMiddleware, personas.updatePersona)
  app.delete("/api/workspace/:workspaceId/personas/:personaId", authMiddleware, personas.deletePersona)

  // ==========================================================================
  // Settings routes (auth required)
  // ==========================================================================
  app.get("/api/workspace/:workspaceId/settings", authMiddleware, settings.getSettings)
  app.patch("/api/workspace/:workspaceId/settings", authMiddleware, settings.updateSettings)
  app.put("/api/workspace/:workspaceId/settings/*", authMiddleware, settings.updateSettingByPath)
  app.delete("/api/workspace/:workspaceId/settings", authMiddleware, settings.resetSettings)

  // Error handling middleware (must be last)
  app.use(createErrorHandler())

  // Serve static files from Vite build in production
  if (isProduction) {
    const distPath = path.join(__dirname, "../../dist/frontend")
    app.use(express.static(distPath))
    app.get("*", (_, res) => res.sendFile(path.join(distPath, "index.html")))
  }

  const server = http.createServer(app)

  const connections = new Set<import("net").Socket>()
  server.on("connection", (socket) => {
    connections.add(socket)
    socket.on("close", () => connections.delete(socket))
  })

  return {
    app,
    server,
    pool,
    authService,
    userService,
    streamService,
    workspaceService,
    redisPubClient,
    redisSubClient,
    outboxListener,
    close: async () => {
      logger.info({ count: connections.size }, "Destroying HTTP connections")
      for (const socket of connections) {
        socket.destroy()
      }
      connections.clear()

      if (server.listening) {
        await attempt(() => promisify(server.close.bind(server))())
      }

      await attempt(() => outboxListener.stop())
      await attempt(() => pool.end())
      await attempt(() => redisPubClient.quit())
      await attempt(() => redisSubClient.quit())
    },
  }
}

export async function startServer(context: AppContext): Promise<void> {
  try {
    validateEnv()
    initLangfuse()

    logger.info("Running database migrations...")
    await runMigrations(context.pool)

    logger.info("Starting outbox listener...")
    await context.outboxListener.start()

    const connectionString = DATABASE_URL
    logger.info("Starting AI workers...")
    await startWorkers(context.pool, connectionString)

    const socketIoServer = await setupStreamWebSocket(context.server, context.pool, context.streamService)

    await promisify(context.server.listen).bind(context.server)(PORT)

    logger.info({ port: PORT }, "Server started")
    logger.info({ url: `http://localhost:${PORT}/api/auth/login` }, "Login endpoint")
    logger.info("Socket.IO available")

    gracefulShutdown({
      context,
      preShutdown: async () => {
        await socketIoServer.closeWithCleanup()
        await stopWorkers()
        await shutdownLangfuse()
      },
      onShutdown: async () => {
        process.exit(0)
      },
      timeoutMs: 30_000,
    })
  } catch (error) {
    logger.error({ err: error }, "Failed to start server")
    await context.close()
    process.exit(1)
  }
}

if (esMain(import.meta.url)) {
  const context = await createApp()
  startServer(context)
}
