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
import { ConversationService } from "./services/conversation-service"
import { BoundaryExtractionService } from "./services/boundary-extraction-service"
import { createS3Storage } from "./lib/storage/s3-client"
import { createBroadcastListener } from "./lib/broadcast-listener"
import { createCompanionListener } from "./lib/companion-listener"
import { createNamingListener } from "./lib/naming-listener"
import { createEmbeddingListener } from "./lib/embedding-listener"
import { createBoundaryExtractionListener } from "./lib/boundary-extraction-listener"
import { createMemoAccumulator } from "./lib/memo-accumulator"
import { MemoClassifier } from "./lib/memo/classifier"
import { Memorizer } from "./lib/memo/memorizer"
import { MemoService } from "./services/memo-service"
import { createCommandListener } from "./lib/command-listener"
import { createMentionInvokeListener } from "./lib/mention-invoke-listener"
import { CommandRegistry } from "./commands"
import { SimulateCommand } from "./commands/simulate-command"
import { createPersonaAgentWorker } from "./workers/persona-agent-worker"
import { createNamingWorker } from "./workers/naming-worker"
import { createEmbeddingWorker } from "./workers/embedding-worker"
import { createBoundaryExtractionWorker } from "./workers/boundary-extraction-worker"
import {
  createMemoBatchCheckWorker,
  createMemoBatchProcessWorker,
  scheduleMemoBatchCheck,
} from "./workers/memo-batch-worker"
import { createSimulationWorker } from "./workers/simulation-worker"
import { LLMBoundaryExtractor } from "./lib/boundary-extraction/llm-extractor"
import { StubBoundaryExtractor } from "./lib/boundary-extraction/stub-extractor"
import { createCommandWorker } from "./workers/command-worker"
import { PersonaAgent } from "./agents/persona-agent"
import { SimulationAgent } from "./agents/simulation-agent"
import { LangGraphResponseGenerator, StubResponseGenerator } from "./agents/companion-runner"
import { JobQueues } from "./lib/job-queue"
import { ulid } from "ulid"
import { loadConfig } from "./lib/env"
import { logger } from "./lib/logger"
import { ProviderRegistry, createPostgresCheckpointer } from "./lib/ai"
import { createJobQueue, type JobQueueManager } from "./lib/job-queue"
import { UserSocketRegistry } from "./lib/user-socket-registry"

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
  const conversationService = new ConversationService(pool)

  // Search and embedding services
  const embeddingService = new EmbeddingService({ providerRegistry })
  const searchService = new SearchService({ pool, embeddingService })

  // Job queue for durable background work (companion responses, etc.)
  const jobQueue = createJobQueue(pool)

  // Create helpers for agents
  const createMessage = (params: Parameters<typeof eventService.createMessage>[0]) => eventService.createMessage(params)
  const createThread = (params: Parameters<typeof streamService.createThread>[0]) => streamService.createThread(params)

  // Simulation agent - needed for SimulateCommand
  const simulationAgent = new SimulationAgent({
    pool,
    providerRegistry,
    streamService,
    checkpointer,
    createMessage,
    orchestratorModel: config.ai.namingModel,
  })

  // Command infrastructure - created early for route registration
  const commandRegistry = new CommandRegistry()
  const simulateCommand = new SimulateCommand({
    pool,
    providerRegistry,
    simulationAgent,
    parsingModel: config.ai.namingModel,
  })
  commandRegistry.register(simulateCommand)

  const app = createApp()

  registerRoutes(app, {
    pool,
    authService,
    userService,
    workspaceService,
    streamService,
    eventService,
    attachmentService,
    searchService,
    conversationService,
    s3Config: config.s3,
    commandRegistry,
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

  const userSocketRegistry = new UserSocketRegistry()
  registerSocketHandlers(io, { authService, userService, streamService, workspaceService, userSocketRegistry })

  const serverId = `server_${ulid()}`

  // Create unified persona agent and register worker
  // Handles both companion mode and @mention invocations
  const responseGenerator = config.useStubCompanion
    ? new StubResponseGenerator()
    : new LangGraphResponseGenerator({
        modelRegistry: providerRegistry,
        checkpointer,
        tavilyApiKey: config.ai.tavilyApiKey || undefined,
      })

  const personaAgent = new PersonaAgent({ pool, responseGenerator, createMessage, createThread })
  const personaAgentWorker = createPersonaAgentWorker({ agent: personaAgent, serverId })
  jobQueue.registerHandler(JobQueues.PERSONA_AGENT, personaAgentWorker)

  const namingWorker = createNamingWorker({ streamNamingService })
  jobQueue.registerHandler(JobQueues.NAMING_GENERATE, namingWorker)

  const embeddingWorker = createEmbeddingWorker({ pool, embeddingService })
  jobQueue.registerHandler(JobQueues.EMBEDDING_GENERATE, embeddingWorker)

  // Boundary extraction
  const boundaryExtractor = config.useStubBoundaryExtraction
    ? new StubBoundaryExtractor()
    : new LLMBoundaryExtractor(providerRegistry, config.ai.extractionModel)
  const boundaryExtractionService = new BoundaryExtractionService(pool, boundaryExtractor)
  const boundaryExtractionWorker = createBoundaryExtractionWorker({ service: boundaryExtractionService })
  jobQueue.registerHandler(JobQueues.BOUNDARY_EXTRACT, boundaryExtractionWorker)

  // Memo (GAM) processing
  const memoClassifier = new MemoClassifier(providerRegistry, config.ai.memoModel)
  const memorizer = new Memorizer(providerRegistry, config.ai.memoModel)
  const memoService = new MemoService({
    pool,
    classifier: memoClassifier,
    memorizer,
    embeddingService,
  })
  const memoBatchCheckWorker = createMemoBatchCheckWorker({ pool, memoService, jobQueue })
  const memoBatchProcessWorker = createMemoBatchProcessWorker({ pool, memoService, jobQueue })
  jobQueue.registerHandler(JobQueues.MEMO_BATCH_CHECK, memoBatchCheckWorker)
  jobQueue.registerHandler(JobQueues.MEMO_BATCH_PROCESS, memoBatchProcessWorker)

  // Simulation worker - for non-command invocations (e.g., API or scheduled runs)
  // Note: /simulate command runs the agent inline via SimulateCommand
  const simulationWorker = createSimulationWorker({ agent: simulationAgent })
  jobQueue.registerHandler(JobQueues.SIMULATE_RUN, simulationWorker)

  // Command execution worker
  const commandWorker = createCommandWorker({ pool, commandRegistry })
  jobQueue.registerHandler(JobQueues.COMMAND_EXECUTE, commandWorker)

  await jobQueue.start()

  // Schedule memo batch check cron job (every 30 seconds)
  await scheduleMemoBatchCheck(jobQueue)

  // Outbox listeners
  const broadcastListener = createBroadcastListener(pool, io, userSocketRegistry)
  const companionListener = createCompanionListener(pool, jobQueue)
  const namingListener = createNamingListener(pool, jobQueue)
  const embeddingListener = createEmbeddingListener(pool, jobQueue)
  const boundaryExtractionListener = createBoundaryExtractionListener(pool, jobQueue)
  const memoAccumulator = createMemoAccumulator(pool)
  const commandListener = createCommandListener(pool, jobQueue)
  const mentionInvokeListener = createMentionInvokeListener({ pool, jobQueue })
  await broadcastListener.start()
  await companionListener.start()
  await mentionInvokeListener.start()
  await namingListener.start()
  await embeddingListener.start()
  await boundaryExtractionListener.start()
  await memoAccumulator.start()
  await commandListener.start()

  await new Promise<void>((resolve) => {
    server.listen(config.port, () => {
      logger.info({ port: config.port }, "Server started")
      resolve()
    })
  })

  const stop = async () => {
    logger.info("Shutting down server...")
    await memoAccumulator.stop()
    await commandListener.stop()
    await embeddingListener.stop()
    await boundaryExtractionListener.stop()
    await namingListener.stop()
    await mentionInvokeListener.stop()
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
