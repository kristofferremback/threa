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
import { AttachmentService } from "./services/attachment-service"
import { StreamNamingService } from "./services/stream-naming-service"
import { SearchService } from "./services/search-service"
import { EmbeddingService } from "./services/embedding-service"
import { createS3Storage } from "./lib/storage/s3-client"
import { createBroadcastListener } from "./lib/broadcast-listener"
import { createCompanionListener } from "./lib/companion-listener"
import { createNamingListener } from "./lib/naming-listener"
import { createEmbeddingListener } from "./lib/embedding-listener"
import { createCompanionWorker } from "./workers/companion-worker"
import { createNamingWorker } from "./workers/naming-worker"
import { createEmbeddingWorker } from "./workers/embedding-worker"
import { CompanionAgent } from "./agents/companion-agent"
import { LangGraphResponseGenerator, StubResponseGenerator } from "./agents/companion-runner"
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
  const authService = config.useStubAuth ? new StubAuthService() : new WorkosAuthService(config.workos)

  // Storage and attachment service
  const storage = createS3Storage(config.s3)
  const attachmentService = new AttachmentService(pool, storage)

  const providerRegistry = new ProviderRegistry({
    openrouter: { apiKey: config.ai.openRouterApiKey },
  })
  const streamNamingService = new StreamNamingService(pool, providerRegistry, config.ai.namingModel)

  // Search and embedding services
  const embeddingService = new EmbeddingService({ apiKey: config.ai.openRouterApiKey })
  const searchService = new SearchService({ pool, embeddingService })

  const app = createApp()

  registerRoutes(app, {
    authService,
    userService,
    workspaceService,
    streamService,
    eventService,
    attachmentService,
    searchService,
    s3Config: config.s3,
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

  registerSocketHandlers(io, { authService, userService, streamService, workspaceService })

  // Job queue for durable background work (companion responses, etc.)
  const jobQueue = createJobQueue(pool)
  const serverId = `server_${ulid()}`

  // Create companion agent and register worker
  const createMessage = (params: Parameters<typeof eventService.createMessage>[0]) => eventService.createMessage(params)

  const responseGenerator = config.useStubCompanion
    ? new StubResponseGenerator()
    : new LangGraphResponseGenerator({ modelRegistry: providerRegistry, checkpointer })

  const companionAgent = new CompanionAgent({ pool, responseGenerator, createMessage })
  const companionWorker = createCompanionWorker({ agent: companionAgent, serverId })
  jobQueue.registerHandler(JobQueues.COMPANION_RESPOND, companionWorker)

  const namingWorker = createNamingWorker({ streamNamingService })
  jobQueue.registerHandler(JobQueues.NAMING_GENERATE, namingWorker)

  const embeddingWorker = createEmbeddingWorker({ pool, embeddingService })
  jobQueue.registerHandler(JobQueues.EMBEDDING_GENERATE, embeddingWorker)

  await jobQueue.start()

  // Outbox listeners
  const broadcastListener = createBroadcastListener(pool, io)
  const companionListener = createCompanionListener(pool, jobQueue)
  const namingListener = createNamingListener(pool, jobQueue)
  const embeddingListener = createEmbeddingListener(pool, jobQueue)
  await broadcastListener.start()
  await companionListener.start()
  await namingListener.start()
  await embeddingListener.start()

  await new Promise<void>((resolve) => {
    server.listen(config.port, () => {
      logger.info({ port: config.port }, "Server started")
      resolve()
    })
  })

  const stop = async () => {
    logger.info("Shutting down server...")
    await embeddingListener.stop()
    await namingListener.stop()
    await companionListener.stop()
    await broadcastListener.stop()
    await jobQueue.stop()
    logger.info("Closing socket.io...")

    // Close socket.io with callback - add timeout since it can hang with postgres adapter
    await Promise.race([
      new Promise<void>((resolve) => io.close(() => resolve())),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          logger.warn("Socket.io close timed out, continuing...")
          resolve()
        }, 5000)
      ),
    ])

    logger.info("Closing HTTP server...")
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    }
    logger.info("Closing database pool...")
    await pool.end()
    logger.info("Server stopped")
  }

  return { server, io, pool, jobQueue, port: config.port, stop }
}
