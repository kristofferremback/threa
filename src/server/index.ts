import express from "express"
import cookieParser from "cookie-parser"
import path from "path"
import { fileURLToPath } from "url"
import http from "http"
import type { Server as HTTPServer } from "http"
import pinoHttp from "pino-http"
import { createAuthRoutes, createAuthMiddleware } from "./routes/auth-routes"
import { createStreamRoutes } from "./routes/stream-routes"
import { createInvitationRoutes } from "./routes/invitation-routes"
import { createSearchRoutes } from "./routes/search-routes"
import { SearchService } from "./services/search-service"
import { setupStreamWebSocket } from "./websockets/stream-socket"
import { isProduction, PORT } from "./config"
import { logger } from "./lib/logger"
import { randomUUID } from "crypto"
import { runMigrations } from "./lib/migrations"
import { createDatabasePool } from "./lib/db"
import { Pool } from "pg"
import { AuthService } from "./services/auth-service"
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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
  let isShuttingDown = false

  const shutdown = async () => {
    if (isShuttingDown) return
    isShuttingDown = true

    const timeout = setTimeout(() => {
      logger.error({ timeoutMs }, "Server shutdown timed out, forcing exit")

      process.exit(1)
    }, timeoutMs)

    try {
      logger.info("Shutting down server gracefully")

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

/**
 * Sets up and configures the Express application and HTTP server
 * Returns the app, server, and dependencies for testing or manual control
 */
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
        return "silent" // Don't log successful requests
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

  app.get("/health", (_, res) => res.json({ status: "ok", message: "Threa API" }))

  if (!isProduction) {
    app.get("/", (_, res) => res.redirect("http://localhost:3000"))
  }

  const pool = createDatabasePool()

  const authService = new AuthService()
  const streamService = new StreamService(pool)
  const userService = new UserService(pool)
  const workspaceService = new WorkspaceService(pool)
  const searchService = new SearchService(pool)
  const outboxListener = new OutboxListener(pool)

  // Create Redis clients for Socket.IO
  const { pubClient: redisPubClient, subClient: redisSubClient } = await createSocketIORedisClients()

  const authMiddleware = createAuthMiddleware(authService)
  const authRoutes = createAuthRoutes(authService, authMiddleware)
  const streamRoutes = createStreamRoutes(streamService, workspaceService, pool)
  const invitationRoutes = createInvitationRoutes(workspaceService, authMiddleware)
  const searchRoutes = createSearchRoutes(searchService)

  app.use("/api/auth", authRoutes)
  app.use("/api/workspace", authMiddleware, streamRoutes)
  app.use("/api/workspace", authMiddleware, searchRoutes)
  // Invitation routes - get is public, accept requires auth
  app.use("/api/invite", invitationRoutes)

  // Error handling middleware (must be last)
  app.use(createErrorHandler())

  // Serve static files from Vite build in production
  if (isProduction) {
    const distPath = path.join(__dirname, "../../dist/frontend")
    app.use(express.static(distPath))

    app.get("*", (_, res) => res.sendFile(path.join(distPath, "index.html")))
  }

  const server = http.createServer(app)

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
      await attempt(() => promisify(server.close).bind(server)())

      await attempt(() => outboxListener.stop())
      await attempt(() => pool.end())
      await attempt(() => redisPubClient.quit())
      await attempt(() => redisSubClient.quit())
    },
  }
}

/**
 * Starts the server with all dependencies (migrations, outbox listener, Socket.IO)
 * Sets up graceful shutdown handlers
 */
export async function startServer(context: AppContext): Promise<void> {
  try {
    // Validate environment variables first
    validateEnv()

    logger.info("Running database migrations...")
    await runMigrations(context.pool)

    logger.info("Starting outbox listener...")
    await context.outboxListener.start()

    // Start AI workers (embedding, classification)
    const connectionString = process.env.DATABASE_URL || "postgresql://localhost:5432/threa"
    logger.info("Starting AI workers...")
    await startWorkers(context.pool, connectionString)

    const socketIoServer = await setupStreamWebSocket(
      context.server,
      context.pool,
      context.streamService,
    )

    await promisify(context.server.listen).bind(context.server)(PORT)

    logger.info({ port: PORT }, "Server started")
    logger.info({ url: `http://localhost:${PORT}/api/auth/login` }, "Login endpoint")
    logger.info("Socket.IO available")

    gracefulShutdown({
      context,
      preShutdown: async () => {
        await socketIoServer.close()
        await stopWorkers()
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

// Start server when this file is executed
// When imported as a module, the exports are available but server will also start
// For testing, y ou can import createApp() and startServer() separately
if (esMain(import.meta.url)) {
  const context = await createApp()
  startServer(context)
}
