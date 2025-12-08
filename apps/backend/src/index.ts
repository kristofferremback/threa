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
import { loadConfig } from "./lib/env"
import { logger } from "./lib/logger"

const config = loadConfig()

const pool = createDatabasePool(config.databaseUrl)

const migrator = createMigrator(pool)
await migrator.up()
logger.info("Database migrations complete")

const userService = new UserService(pool)
const authService = config.useStubAuth
  ? new StubAuthService()
  : new WorkosAuthService(config.workos)

const app = createApp()

registerRoutes(app, { authService, userService })

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

server.listen(config.port, () => {
  logger.info({ port: config.port }, "Server started")
})
