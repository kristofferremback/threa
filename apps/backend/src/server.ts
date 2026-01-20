import { createServer, Server } from "http"
import { Server as SocketIOServer } from "socket.io"
import { createAdapter } from "@socket.io/postgres-adapter"
import { Pool } from "pg"
import { createApp } from "./app"
import { registerRoutes } from "./routes"
import { errorHandler } from "./middleware/error-handler"
import { registerSocketHandlers } from "./socket"
import { createDatabasePools, type DatabasePools } from "./db"
import { createMigrator } from "./db/migrations"
import { WorkosAuthService } from "./services/auth-service"
import { StubAuthService } from "./services/auth-service.stub"
import { UserService } from "./services/user-service"
import { WorkspaceService } from "./services/workspace-service"
import { StreamService } from "./services/stream-service"
import { EventService } from "./services/event-service"
import { AttachmentService } from "./services/attachment-service"
import { StreamNamingService } from "./services/stream-naming-service"
import { StubStreamNamingService } from "./services/stream-naming-service.stub"
import { MessageFormatter } from "./lib/ai/message-formatter"
import { SearchService } from "./services/search-service"
import { EmbeddingService } from "./services/embedding-service"
import { StubEmbeddingService } from "./services/embedding-service.stub"
import { ConversationService } from "./services/conversation-service"
import { UserPreferencesService } from "./services/user-preferences-service"
import { BoundaryExtractionService } from "./services/boundary-extraction-service"
import { createS3Storage } from "./lib/storage/s3-client"
import { OutboxDispatcher } from "./lib/outbox-dispatcher"
import { BroadcastHandler } from "./lib/broadcast-handler"
import { CompanionHandler } from "./lib/companion-handler"
import { NamingHandler } from "./lib/naming-handler"
import { EmojiUsageHandler } from "./lib/emoji-usage-handler"
import { EmbeddingHandler } from "./lib/embedding-handler"
import { BoundaryExtractionHandler } from "./lib/boundary-extraction-handler"
import { MemoAccumulatorHandler } from "./lib/memo-accumulator-handler"
import { CommandHandler } from "./lib/command-handler"
import { MentionInvokeHandler } from "./lib/mention-invoke-handler"
import { MemoClassifier } from "./lib/memo/classifier"
import { Memorizer } from "./lib/memo/memorizer"
import { MemoService } from "./services/memo-service"
import { StubMemoService } from "./services/memo-service.stub"
import { AICostService } from "./services/ai-cost-service"
import { createOrphanSessionCleanup } from "./lib/orphan-session-cleanup"
import { CommandRegistry } from "./commands"
import { SimulateCommand } from "./commands/simulate-command"
import { createPersonaAgentWorker } from "./workers/persona-agent-worker"
import { Researcher } from "./agents/researcher"
import { createNamingWorker } from "./workers/naming-worker"
import { createEmbeddingWorker } from "./workers/embedding-worker"
import { createBoundaryExtractionWorker } from "./workers/boundary-extraction-worker"
import { createMemoBatchCheckWorker, createMemoBatchProcessWorker } from "./workers/memo-batch-worker"
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
import { parseMarkdown } from "@threa/prosemirror"
import { normalizeMessage, toEmoji } from "./lib/emoji"
import { logger } from "./lib/logger"
import { createPostgresCheckpointer } from "./lib/ai"
import { createAI } from "./lib/ai/ai"
import { QueueManager } from "./lib/queue-manager"
import { ScheduleManager } from "./lib/schedule-manager"
import { CleanupWorker } from "./lib/cleanup-worker"
import { QueueRepository } from "./repositories/queue-repository"
import { TokenPoolRepository } from "./repositories/token-pool-repository"
import { UserSocketRegistry } from "./lib/user-socket-registry"

export interface ServerInstance {
  server: Server
  io: SocketIOServer
  pools: DatabasePools
  jobQueue: QueueManager
  port: number
  isDevelopment: boolean
  stop: () => Promise<void>
}

export async function startServer(): Promise<ServerInstance> {
  const config = loadConfig()

  // Create separated connection pools:
  // - main: services, workers, queue system, HTTP handlers (30 connections)
  // - listen: OutboxListener LISTEN connections (12 connections)
  const pools = createDatabasePools(config.databaseUrl)
  const pool = pools.main // Alias for backwards compatibility during transition

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

  // Create cost tracking service for AI usage
  const costService = new AICostService({ pool })

  const ai = createAI({
    openrouter: { apiKey: config.ai.openRouterApiKey },
    costRecorder: costService,
  })
  const messageFormatter = new MessageFormatter()
  const streamNamingService = config.useStubAI
    ? new StubStreamNamingService()
    : new StreamNamingService(pool, ai, config.ai.namingModel, messageFormatter)
  const conversationService = new ConversationService(pool)
  const userPreferencesService = new UserPreferencesService(pool)

  // Search and embedding services
  const embeddingService = config.useStubAI ? new StubEmbeddingService() : new EmbeddingService({ ai })
  const searchService = new SearchService({ pool, embeddingService })

  // Job queue for durable background work (companion responses, etc.)
  const jobQueue = new QueueManager({
    pool,
    queueRepository: QueueRepository,
    tokenPoolRepository: TokenPoolRepository,
    // Optimized for throughput with batch operations:
    // - maxConcurrency=2: max 2 ticks running in parallel
    // - tokenBatchSize=10: each tick leases up to 10 tokens (queue,workspace pairs)
    // - claimBatchSize=20: each token claims up to 20 messages in one query
    // - processingConcurrency=5: process 5 messages in parallel per token
    //
    // Max workers: 2 ticks × 10 tokens = 20 workers
    // Max parallel processing: 20 workers × 5 concurrent = 100 messages
    // Connection usage: batch operations reduce queries by 10-20x vs serial
    // Peak connections: ~10-15 (operations are fast, connections released immediately)
    maxConcurrency: 2,
  })

  // Schedule manager for cron tick generation
  const scheduleManager = new ScheduleManager(pool, {
    lookaheadSeconds: 60, // Generate ticks for next minute
    intervalMs: 10000, // Check every 10 seconds
    batchSize: 100, // Process up to 100 schedules per run
  })

  // Cleanup worker for expired and orphaned cron ticks
  const cleanupWorker = new CleanupWorker(pool, {
    intervalMs: 300000, // Run every 5 minutes
    expiredThresholdMs: 300000, // Delete ticks expired for 5+ minutes
  })

  // Create helpers for agents
  // This adapter accepts markdown content and converts to JSON+markdown format
  const createMessage = async (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: "user" | "persona"
    content: string
    sources?: { title: string; url: string }[]
  }) => {
    const contentMarkdown = normalizeMessage(params.content)
    const contentJson = parseMarkdown(contentMarkdown, undefined, toEmoji)
    return eventService.createMessage({
      workspaceId: params.workspaceId,
      streamId: params.streamId,
      authorId: params.authorId,
      authorType: params.authorType,
      contentJson,
      contentMarkdown,
      sources: params.sources,
    })
  }
  const createThread = (params: Parameters<typeof streamService.createThread>[0]) => streamService.createThread(params)

  // Simulation agent - needed for SimulateCommand
  const simulationAgent = new SimulationAgent({
    pool,
    ai,
    streamService,
    checkpointer,
    createMessage,
    orchestratorModel: config.ai.namingModel,
  })

  // Command infrastructure - created early for route registration
  const commandRegistry = new CommandRegistry()
  const simulateCommand = new SimulateCommand({
    pool,
    ai,
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
    userPreferencesService,
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
        ai,
        checkpointer,
        tavilyApiKey: config.ai.tavilyApiKey || undefined,
        costRecorder: costService,
      })

  // Create researcher for workspace knowledge retrieval
  const researcher = new Researcher({ pool, ai, embeddingService })

  const personaAgent = new PersonaAgent({
    pool,
    responseGenerator,
    userPreferencesService,
    researcher,
    searchService,
    createMessage,
    createThread,
  })
  const personaAgentWorker = createPersonaAgentWorker({ agent: personaAgent, serverId, pool, jobQueue })
  jobQueue.registerHandler(JobQueues.PERSONA_AGENT, personaAgentWorker)

  const namingWorker = createNamingWorker({ streamNamingService })
  jobQueue.registerHandler(JobQueues.NAMING_GENERATE, namingWorker)

  const embeddingWorker = createEmbeddingWorker({ pool, embeddingService })
  jobQueue.registerHandler(JobQueues.EMBEDDING_GENERATE, embeddingWorker)

  // Boundary extraction
  const boundaryExtractor = config.useStubBoundaryExtraction
    ? new StubBoundaryExtractor()
    : new LLMBoundaryExtractor(ai, config.ai.extractionModel)
  const boundaryExtractionService = new BoundaryExtractionService(pool, boundaryExtractor)
  const boundaryExtractionWorker = createBoundaryExtractionWorker({ service: boundaryExtractionService })
  jobQueue.registerHandler(JobQueues.BOUNDARY_EXTRACT, boundaryExtractionWorker)

  // Memo (GAM) processing
  const memoService = config.useStubAI
    ? new StubMemoService()
    : new MemoService({
        pool,
        classifier: new MemoClassifier(ai, config.ai.memoModel, messageFormatter),
        memorizer: new Memorizer(ai, config.ai.memoModel, messageFormatter),
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

  // Register handlers before starting
  await jobQueue.start()

  // Start schedule manager and cleanup worker
  scheduleManager.start()
  cleanupWorker.start()

  // Schedule memo batch check cron job (every 30 seconds)
  await jobQueue.schedule(JobQueues.MEMO_BATCH_CHECK, 30, { workspaceId: "system" })

  // Outbox dispatcher - single LISTEN connection fans out to all handlers
  const outboxDispatcher = new OutboxDispatcher({ listenPool: pools.listen })

  // Create handlers - each manages its own cursor, debouncing, and processing
  const broadcastHandler = new BroadcastHandler(pool, io, userSocketRegistry)
  const companionHandler = new CompanionHandler(pool, jobQueue)
  const namingHandler = new NamingHandler(pool, jobQueue)
  const emojiUsageHandler = new EmojiUsageHandler(pool)
  const embeddingHandler = new EmbeddingHandler(pool, jobQueue)
  const boundaryExtractionHandler = new BoundaryExtractionHandler(pool, jobQueue)
  const memoAccumulatorHandler = new MemoAccumulatorHandler(pool)
  const commandHandler = new CommandHandler(pool, jobQueue)
  const mentionInvokeHandler = new MentionInvokeHandler(pool, jobQueue)

  // Ensure listeners exist in database
  await broadcastHandler.ensureListener()
  await companionHandler.ensureListener()
  await namingHandler.ensureListener()
  await emojiUsageHandler.ensureListener()
  await embeddingHandler.ensureListener()
  await boundaryExtractionHandler.ensureListener()
  await memoAccumulatorHandler.ensureListener()
  await commandHandler.ensureListener()
  await mentionInvokeHandler.ensureListener()

  // Register all handlers with dispatcher
  outboxDispatcher.register(broadcastHandler)
  outboxDispatcher.register(companionHandler)
  outboxDispatcher.register(namingHandler)
  outboxDispatcher.register(emojiUsageHandler)
  outboxDispatcher.register(embeddingHandler)
  outboxDispatcher.register(boundaryExtractionHandler)
  outboxDispatcher.register(memoAccumulatorHandler)
  outboxDispatcher.register(commandHandler)
  outboxDispatcher.register(mentionInvokeHandler)

  // Start single LISTEN connection that notifies all handlers
  await outboxDispatcher.start()

  const orphanSessionCleanup = createOrphanSessionCleanup(pools.main)
  orphanSessionCleanup.start()

  await new Promise<void>((resolve) => {
    server.listen(config.port, () => {
      logger.info({ port: config.port }, "Server started")
      resolve()
    })
  })

  const stop = async () => {
    // In development mode, skip graceful shutdown for immediate termination
    if (config.isDevelopment) {
      logger.info("Development mode - skipping graceful shutdown")
      // Force close everything immediately
      server.close()
      io.close()
      await pools.listen.end()
      await pools.main.end()
      return
    }

    logger.info("Shutting down server...")
    orphanSessionCleanup.stop()
    await scheduleManager.stop()
    await cleanupWorker.stop()
    await outboxDispatcher.stop()
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
    logger.info("Closing database pools...")
    await pools.listen.end()
    await pools.main.end()
    logger.info("Server stopped")
  }

  return { server, io, pools, jobQueue, port: config.port, isDevelopment: config.isDevelopment, stop }
}
