import { createServer, Server } from "http"
import { Server as SocketIOServer } from "socket.io"
import { createAdapter } from "@socket.io/postgres-adapter"
import { Pool } from "pg"
import { createApp } from "./app"
import { registerRoutes } from "./routes"
import { errorHandler } from "./middleware/error-handler"
import { registerSocketHandlers } from "./socket"
import { createDatabasePool } from "./db"
import { createMigrator } from "./db/migrations"
import { WorkosAuthService } from "./services/auth-service"
import { StubAuthService } from "./services/auth-service.stub"
import { UserService } from "./services/user-service"
import { WorkspaceService } from "./services/workspace-service"
import { StreamService } from "./services/stream-service"
import { EventService } from "./services/event-service"
import { StreamNamingService } from "./services/stream-naming-service"
import { createBroadcastListener } from "./lib/broadcast-listener"
import { loadConfig } from "./lib/env"
import { logger } from "./lib/logger"
import { OpenRouterClient } from "./lib/openrouter"

export interface ServerInstance {
  server: Server
  io: SocketIOServer
  pool: Pool
  port: number
  stop: () => Promise<void>
}

export async function startServer(): Promise<ServerInstance> {
  const config = loadConfig()

  const pool = createDatabasePool(config.databaseUrl)

  const migrator = createMigrator(pool)
  await migrator.up()
  logger.info("Database migrations complete")

  const userService = new UserService(pool)
  const workspaceService = new WorkspaceService(pool)
  const streamService = new StreamService(pool)
  const eventService = new EventService(pool)
  const authService = config.useStubAuth
    ? new StubAuthService()
    : new WorkosAuthService(config.workos)

  const openRouterClient = new OpenRouterClient(
    config.openrouter.apiKey,
    config.openrouter.defaultModel,
  )
  const streamNamingService = new StreamNamingService(pool, openRouterClient)
  eventService.setStreamNamingService(streamNamingService)

  const app = createApp()

  registerRoutes(app, {
    authService,
    userService,
    workspaceService,
    streamService,
    eventService,
  })

  app.use(errorHandler)

  const server = createServer(app)

  const io = new SocketIOServer(server, {
    path: "/socket.io/",
    cors: {
      origin: true,
      credentials: true,
    },
  })

  io.adapter(createAdapter(pool))

  registerSocketHandlers(io, { authService, userService, streamService })

  const broadcastListener = createBroadcastListener(pool, io)
  await broadcastListener.start()

  await new Promise<void>((resolve) => {
    server.listen(config.port, () => {
      logger.info({ port: config.port }, "Server started")
      resolve()
    })
  })

  const stop = async () => {
    logger.info("Shutting down server...")
    await broadcastListener.stop()
    io.close()
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
    await pool.end()
    logger.info("Server stopped")
  }

  return { server, io, pool, port: config.port, stop }
}
