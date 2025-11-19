import express from "express"
import cookieParser from "cookie-parser"
import path from "path"
import { fileURLToPath } from "url"
import http from "http"
import type { Server as HTTPServer } from "http"
import pinoHttp from "pino-http"
import { createAuthRoutes, createAuthMiddleware } from "./routes/auth"
import { createSocketIOServer } from "./websockets"
import { PORT } from "./config"
import { logger } from "./lib/logger"
import { randomUUID } from "crypto"
import { runMigrations } from "./lib/migrations"
import { startOutboxListener, stopOutboxListener } from "./lib/outbox-listener"
import { closeConnections, pool } from "./lib/db"
import { AuthService } from "./lib/auth-service"
import { UserService } from "./lib/user-service"
import { MessageService } from "./lib/messages"
import { validateEnv } from "./lib/env-validator"
import { createErrorHandler } from "./middleware/error-handler"
import { createSocketIORedisClients, type RedisClient } from "./lib/redis"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface AppContext {
  app: express.Application
  server: HTTPServer
  authService: AuthService
  userService: UserService
  messageService: MessageService
  redisPubClient: RedisClient
  redisSubClient: RedisClient
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

  if (process.env.NODE_ENV !== "production") {
    app.get("/", (_, res) => res.redirect("http://localhost:3000"))
  }

  // Create services with dependency injection
  const authService = new AuthService()
  const userService = new UserService(pool)
  const messageService = new MessageService(pool, userService)

  // Create Redis clients for Socket.IO
  const { pubClient: redisPubClient, subClient: redisSubClient } = await createSocketIORedisClients()

  const authRoutes = createAuthRoutes(authService)
  const authMiddleware = createAuthMiddleware(authService)

  app.use("/api/auth", authRoutes)
  app.use("/api/", authMiddleware)

  // Error handling middleware (must be last)
  app.use(createErrorHandler())

  // Serve static files from Vite build in production
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(__dirname, "../../dist/frontend")
    app.use(express.static(distPath))

    app.get("*", (_, res) => res.sendFile(path.join(distPath, "index.html")))
  }

  const server = http.createServer(app)

  return {
    app,
    server,
    authService,
    userService,
    messageService,
    redisPubClient,
    redisSubClient,
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
    await runMigrations()

    logger.info("Starting outbox listener...")
    await startOutboxListener()

    await createSocketIOServer(
      context.server,
      context.authService,
      context.userService,
      context.messageService,
      context.redisPubClient,
      context.redisSubClient,
    )

    context.server.listen(PORT, () => {
      logger.info({ port: PORT }, "Server started")
      logger.info({ url: `http://localhost:${PORT}/api/auth/login` }, "Login endpoint")
      logger.info("Socket.IO available")
    })

    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received, shutting down gracefully")
      context.server.close()
      await stopOutboxListener()
      await closeConnections()
      process.exit(0)
    })

    process.on("SIGINT", async () => {
      logger.info("SIGINT received, shutting down gracefully")
      context.server.close()
      await stopOutboxListener()
      await closeConnections()
      process.exit(0)
    })
  } catch (error) {
    logger.error({ err: error }, "Failed to start server")
    process.exit(1)
  }
}

// Start server when this file is executed
// When imported as a module, the exports are available but server will also start
// For testing, you can import createApp() and startServer() separately
const context = await createApp()
startServer(context)
