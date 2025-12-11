/**
 * Test server module - starts the backend app programmatically for e2e tests.
 *
 * Uses a separate test database and random port to avoid conflicts with
 * any running development server.
 */

import { createServer, Server } from "http"
import { Server as SocketIOServer } from "socket.io"
import { createAdapter } from "@socket.io/postgres-adapter"
import { Pool } from "pg"
import { createApp } from "../src/app"
import { registerRoutes } from "../src/routes"
import { errorHandler } from "../src/middleware/error-handler"
import { registerSocketHandlers } from "../src/socket"
import { createDatabasePool } from "../src/db"
import { createMigrator } from "../src/db/migrations"
import { StubAuthService } from "../src/services/auth-service.stub"
import { UserService } from "../src/services/user-service"
import { WorkspaceService } from "../src/services/workspace-service"
import { StreamService } from "../src/services/stream-service"
import { EventService } from "../src/services/event-service"
import { StreamNamingService } from "../src/services/stream-naming-service"
import { OutboxListener } from "../src/lib/outbox-listener"
import { OpenRouterClient } from "../src/lib/openrouter"

export interface TestServer {
  url: string
  port: number
  pool: Pool
  stop: () => Promise<void>
}

interface ServerComponents {
  server: Server
  io: SocketIOServer
  pool: Pool
  outboxListener: OutboxListener
}

/**
 * Gets the test database URL, defaulting to threa_test on local postgres.
 * This ensures tests never accidentally touch the development database.
 */
function getTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL
  }
  // Default: same postgres server, different database name
  return "postgresql://threa:threa@localhost:5454/threa_test"
}

/**
 * Creates the test database if it doesn't exist.
 * Connects to the default postgres database to run CREATE DATABASE.
 */
async function ensureTestDatabaseExists(): Promise<void> {
  const adminPool = new Pool({
    connectionString: "postgresql://threa:threa@localhost:5454/postgres",
  })

  try {
    const result = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = 'threa_test'"
    )

    if (result.rows.length === 0) {
      await adminPool.query("CREATE DATABASE threa_test")
    }
  } finally {
    await adminPool.end()
  }
}

/**
 * Finds a random available port for the test server.
 */
async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, () => {
      const address = server.address()
      if (address && typeof address === "object") {
        const port = address.port
        server.close(() => resolve(port))
      } else {
        reject(new Error("Could not get server address"))
      }
    })
    server.on("error", reject)
  })
}

/**
 * Starts a test server on a random port with its own database connection.
 * Returns a TestServer object with URL and stop() method.
 */
export async function startTestServer(): Promise<TestServer> {
  // Ensure test database exists
  await ensureTestDatabaseExists()

  const databaseUrl = getTestDatabaseUrl()
  const port = await findAvailablePort()

  const pool = createDatabasePool(databaseUrl)

  // Run migrations on test database
  const migrator = createMigrator(pool)
  await migrator.up()

  // Create services with stub auth (always for tests)
  const userService = new UserService(pool)
  const workspaceService = new WorkspaceService(pool)
  const streamService = new StreamService(pool)
  const eventService = new EventService(pool)
  const authService = new StubAuthService()

  // Mock OpenRouter client for tests (or use real one if API key provided)
  const openRouterClient = new OpenRouterClient(
    process.env.OPENROUTER_API_KEY || "",
    process.env.OPENROUTER_DEFAULT_MODEL || "anthropic/claude-3-haiku"
  )
  const streamNamingService = new StreamNamingService(pool, openRouterClient)
  eventService.setStreamNamingService(streamNamingService)

  // Create Express app
  const app = createApp()

  registerRoutes(app, {
    authService,
    userService,
    workspaceService,
    streamService,
    eventService,
  })

  app.use(errorHandler)

  // Create HTTP server
  const server = createServer(app)

  // Create Socket.io server
  const io = new SocketIOServer(server, {
    path: "/socket.io/",
    cors: {
      origin: true,
      credentials: true,
    },
  })

  io.adapter(createAdapter(pool))

  registerSocketHandlers(io, { authService, userService, streamService })

  // Start outbox listener
  const outboxListener = new OutboxListener(pool, io)
  await outboxListener.start()

  // Start listening
  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve())
  })

  const url = `http://localhost:${port}`

  const stop = async () => {
    await outboxListener.stop()
    io.close()
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
    await pool.end()
  }

  return { url, port, pool, stop }
}
