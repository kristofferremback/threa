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
import { createCompanionListener } from "./lib/companion-listener"
import { createCompanionWorker } from "./workers/companion-worker"
import { createStubCompanionWorker } from "./workers/companion-worker.stub"
import { CompanionAgent } from "./agents/companion-agent"
import { StubCompanionAgent } from "./agents/companion-agent.stub"
import { JobQueues } from "./lib/job-queue"
import { ulid } from "ulid"
import { loadConfig } from "./lib/env"
import { logger } from "./lib/logger"
import { ProviderRegistry, createPostgresCheckpointer } from "./lib/ai"
import { createJobQueue, type JobQueueManager } from "./lib/job-queue"

export interface ServerInstance {
  server: Server
  io: SocketIOServer
  pool: Pool
  jobQueue: JobQueueManager
  port: number
  stop: () => Promise<void>
}

export async function startServer(): Promise<ServerInstance> {
  const config = loadConfig()

  const pool = createDatabasePool(config.databaseUrl)

  const migrator = createMigrator(pool)
  await migrator.up()
  logger.info("Database migrations complete")

  // Initialize LangGraph checkpointer (creates tables in langgraph schema)
  const checkpointer = await createPostgresCheckpointer(pool)

  const userService = new UserService(pool)
  const workspaceService = new WorkspaceService(pool)
  const streamService = new StreamService(pool)
  const eventService = new EventService(pool)
  const authService = config.useStubAuth
    ? new StubAuthService()
    : new WorkosAuthService(config.workos)

  const providerRegistry = new ProviderRegistry({
    openrouter: { apiKey: config.ai.openRouterApiKey },
  })
  const streamNamingService = new StreamNamingService(pool, providerRegistry, config.ai.namingModel)
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

  // Job queue for durable background work (companion responses, etc.)
  const jobQueue = createJobQueue(pool)
  const serverId = `server_${ulid()}`

  // Create companion agent and register worker
  const createMessage = (params: Parameters<typeof eventService.createMessage>[0]) =>
    eventService.createMessage(params)

  const companionAgent = config.useStubCompanion
    ? new StubCompanionAgent({ pool, createMessage })
    : new CompanionAgent({ pool, modelRegistry: providerRegistry, checkpointer, createMessage })

  const companionWorker = config.useStubCompanion
    ? createStubCompanionWorker({ agent: companionAgent as StubCompanionAgent, serverId })
    : createCompanionWorker({ agent: companionAgent as CompanionAgent, serverId })
  jobQueue.registerHandler(JobQueues.COMPANION_RESPOND, companionWorker)

  await jobQueue.start()

  // Outbox listeners
  const broadcastListener = createBroadcastListener(pool, io)
  const companionListener = createCompanionListener(pool, jobQueue)
  await broadcastListener.start()
  await companionListener.start()

  await new Promise<void>((resolve) => {
    server.listen(config.port, () => {
      logger.info({ port: config.port }, "Server started")
      resolve()
    })
  })

  const stop = async () => {
    logger.info("Shutting down server...")
    await companionListener.stop()
    await broadcastListener.stop()
    await jobQueue.stop()
    io.close()
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
    await pool.end()
    logger.info("Server stopped")
  }

  return { server, io, pool, jobQueue, port: config.port, stop }
}
