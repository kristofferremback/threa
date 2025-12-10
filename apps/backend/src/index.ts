import { createServer } from "http"
import { Server } from "socket.io"
import { createAdapter } from "@socket.io/postgres-adapter"
import { createApp } from "./app"
import { registerRoutes } from "./routes"
import { registerSocketHandlers } from "./socket"
import { createDatabasePool } from "./db"
import { createMigrator } from "./db/migrations"
import { WorkosAuthService } from "./services/auth-service"
import { StubAuthService } from "./services/auth-service.stub"
import { UserService } from "./services/user-service"
import { WorkspaceService } from "./services/workspace-service"
import { StreamService } from "./services/stream-service"
import { EventService } from "./services/event-service"
import { OutboxListener } from "./lib/outbox-listener"
import { loadConfig } from "./lib/env"
import { logger } from "./lib/logger"

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

const app = createApp()

registerRoutes(app, {
  authService,
  userService,
  workspaceService,
  streamService,
  eventService,
})

const server = createServer(app)

const io = new Server(server, {
  path: "/socket.io/",
  cors: {
    origin: true,
    credentials: true,
  },
})

io.adapter(createAdapter(pool))

registerSocketHandlers(io, { authService, userService })

// Start outbox listener for real-time event delivery
const outboxListener = new OutboxListener(pool, io)
outboxListener.start()

server.listen(config.port, () => {
  logger.info({ port: config.port }, "Server started")
})
