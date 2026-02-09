import { createServer, Server } from "http"
import { Server as SocketIOServer } from "socket.io"
import { createAdapter } from "@socket.io/postgres-adapter"
import { Pool } from "pg"
import { createApp } from "./app"
import { registerRoutes } from "./routes"
import { errorHandler } from "./middleware/error-handler"
import { registerSocketHandlers } from "./socket"
import { createDatabasePools, warmPool, type DatabasePools } from "./db"
import { runMigrations } from "./db/migrations"
import { WorkosAuthService } from "./auth/auth-service"
import { StubAuthService } from "./auth/auth-service.stub"
import { UserService } from "./auth/user-service"
import { WorkspaceService } from "./features/workspaces"
import {
  StreamService,
  StreamNamingService,
  StubStreamNamingService,
  NamingHandler,
  createNamingWorker,
} from "./features/streams"
import { EventService } from "./features/messaging"
import { AttachmentService } from "./features/attachments"
import { MessageFormatter } from "./lib/ai/message-formatter"
import { SearchService } from "./features/search"
import {
  MemoService,
  StubMemoService,
  MemoClassifier,
  Memorizer,
  EmbeddingService,
  StubEmbeddingService,
  EmbeddingHandler,
  MemoAccumulatorHandler,
  createEmbeddingWorker,
  createMemoBatchCheckWorker,
  createMemoBatchProcessWorker,
} from "./features/memos"
import {
  ConversationService,
  BoundaryExtractionService,
  BoundaryExtractionHandler,
  createBoundaryExtractionWorker,
  LLMBoundaryExtractor,
  StubBoundaryExtractor,
} from "./features/conversations"
import { UserPreferencesService } from "./features/user-preferences"
import { createS3Storage } from "./lib/storage/s3-client"
import { OutboxDispatcher, BroadcastHandler } from "./lib/outbox"
import {
  CompanionHandler,
  MentionInvokeHandler,
  createOrphanSessionCleanup,
  createPersonaAgentWorker,
  Researcher,
  createSimulationWorker,
  PersonaAgent,
  TraceEmitter,
  SimulationAgent,
  StubSimulationAgent,
  LangGraphResponseGenerator,
  StubResponseGenerator,
  AgentSessionMetricsCollector,
} from "./features/agents"
import { EmojiUsageHandler } from "./features/emoji"
import { AttachmentUploadedHandler } from "./features/attachments"
import { AICostService } from "./features/ai-usage"
import { CommandRegistry, SimulateCommand, createCommandWorker, CommandHandler } from "./features/commands"
import {
  createImageCaptionWorker,
  createPdfPrepareWorker,
  createPdfPageWorker,
  createPdfAssembleWorker,
  createTextProcessingWorker,
  createWordProcessingWorker,
  createExcelProcessingWorker,
  ImageCaptionService,
  StubImageCaptionService,
  PdfProcessingService,
  StubPdfProcessingService,
  TextProcessingService,
  StubTextProcessingService,
  WordProcessingService,
  StubWordProcessingService,
  ExcelProcessingService,
  StubExcelProcessingService,
} from "./features/attachments"
import {
  JobQueues,
  type OnDLQHook,
  type ImageCaptionJobData,
  type PdfPrepareJobData,
  type PdfProcessPageJobData,
  type PdfAssembleJobData,
  type TextProcessJobData,
  type WordProcessJobData,
  type ExcelProcessJobData,
} from "./lib/queue"
import { ProcessingStatuses } from "@threa/types"
import { AttachmentRepository } from "./features/attachments"
import { ulid } from "ulid"
import { loadConfig } from "./lib/env"
import { createCorsOriginChecker } from "./lib/cors"
import { parseMarkdown } from "@threa/prosemirror"
import { normalizeMessage, toEmoji } from "./features/emoji"
import { logger } from "./lib/logger"
import { createPostgresCheckpointer } from "./lib/ai"
import { createAI } from "./lib/ai/ai"
import { createModelRegistry } from "./lib/ai/model-registry"
import { createStaticConfigResolver } from "./lib/ai/static-config-resolver"
import { QueueManager, ScheduleManager, CleanupWorker, QueueRepository, TokenPoolRepository } from "./lib/queue"
import { UserSocketRegistry } from "./lib/user-socket-registry"
import { PoolMonitor } from "./lib/observability"

export interface ServerInstance {
  server: Server
  io: SocketIOServer
  pools: DatabasePools
  jobQueue: QueueManager
  poolMonitor: PoolMonitor
  port: number
  fastShutdown: boolean
  stop: () => Promise<void>
}

export async function startServer(): Promise<ServerInstance> {
  const config = loadConfig()

  // Initialize Prometheus metrics collection
  const { collectDefaultMetrics } = await import("./lib/observability")
  collectDefaultMetrics()
  logger.info("Prometheus metrics collection initialized")

  // Handle PostgreSQL idle-session timeout errors globally
  // These are EXPECTED with idle_session_timeout=60s - don't crash the process
  process.on("uncaughtException", (err: Error & { code?: string }) => {
    if (err.code === "57P05") {
      logger.warn(
        {
          code: err.code,
          message: err.message,
          stack: err.stack,
        },
        "Uncaught idle-session timeout error - connection was killed by PostgreSQL (expected with 60s timeout)"
      )
      // Don't exit - this is expected behavior, connection will be removed from pool
      return
    }

    // For all other uncaught exceptions, log and exit
    logger.fatal({ err }, "Uncaught exception")
    process.exit(1)
  })

  // Create separated connection pools:
  // - main: services, workers, queue system, HTTP handlers (30 connections)
  // - listen: OutboxListener LISTEN connections (12 connections)
  const pools = createDatabasePools(config.databaseUrl)
  const pool = pools.main // Alias for backwards compatibility during transition

  // Start monitoring pool health
  // Note: Logging disabled - use Grafana dashboard for monitoring
  // Will still log warnings for high utilization or waiting connections
  const poolMonitor = new PoolMonitor(
    { main: pools.main, listen: pools.listen },
    {
      logIntervalMs: 30000, // Update metrics every 30 seconds
      warnThreshold: 80, // Warn when 80% utilized
      disableLogging: true, // Disable periodic console logs (use Grafana instead)
    }
  )
  poolMonitor.start()

  await runMigrations(pool)
  logger.info("Database migrations complete")

  // Pre-warm pool before starting workers to prevent thundering herd
  // When 15+ workers start simultaneously, they all try to connect at once
  // which can overwhelm an empty pool and cause phantom connections
  logger.info("Pre-warming connection pool...")
  await warmPool(pools.main, 15) // Pre-create 15 connections for workers
  logger.info("Connection pool pre-warmed")

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
  const modelRegistry = createModelRegistry()
  const configResolver = createStaticConfigResolver()
  const messageFormatter = new MessageFormatter()
  const streamNamingService = config.useStubAI
    ? new StubStreamNamingService()
    : new StreamNamingService(pool, ai, configResolver, messageFormatter)
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
    // Adaptive polling with bounded parallelism:
    // - pollIntervalMs=500: sleep 500ms between cycles when idle
    // - refillDebounceMs=100: debounce before fetching more tokens
    // - maxActiveTokens=3: max 3 tokens in flight at once
    // - processingConcurrency=3: max 3 messages per token
    //
    // Max concurrent handlers: 3 × 3 = 9 handlers
    // Peak connections: ~9-10 (safe for 30 connection pool)
    pollIntervalMs: Number(process.env.QUEUE_POLL_INTERVAL_MS) || 500,
    refillDebounceMs: 100,
    maxActiveTokens: Number(process.env.QUEUE_MAX_ACTIVE_TOKENS) || 3,
    processingConcurrency: 3,
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

  // Agent session metrics collector
  const agentSessionMetrics = new AgentSessionMetricsCollector(pool)

  // Create helpers for agents
  // This adapter accepts markdown content and converts to JSON+markdown format
  const createMessage = async (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: "member" | "persona"
    content: string
    sources?: { title: string; url: string }[]
    sessionId?: string
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
      sessionId: params.sessionId,
    })
  }
  const createThread = (params: Parameters<typeof streamService.createThread>[0]) => streamService.createThread(params)

  // Simulation agent - needed for SimulateCommand
  const simulationAgent = config.useStubAI
    ? new StubSimulationAgent()
    : new SimulationAgent({
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

  const isProduction = process.env.NODE_ENV === "production"
  const app = createApp({ corsAllowedOrigins: config.corsAllowedOrigins, isProduction })

  registerRoutes(app, {
    pool,
    poolMonitor,
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
    rateLimiterConfig: config.rateLimits,
    allowDevAuthRoutes: config.useStubAuth && !isProduction,
  })

  app.use(errorHandler)

  const server = createServer(app)

  const io = new SocketIOServer(server, {
    path: "/socket.io/",
    cors: {
      origin: createCorsOriginChecker(config.corsAllowedOrigins),
      credentials: true,
    },
  })

  io.adapter(createAdapter(pool))

  const userSocketRegistry = new UserSocketRegistry()
  registerSocketHandlers(io, { pool, authService, userService, streamService, workspaceService, userSocketRegistry })

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
  const researcher = new Researcher({ pool, ai, configResolver, embeddingService })

  const traceEmitter = new TraceEmitter({ io, pool })
  const personaAgent = new PersonaAgent({
    pool,
    traceEmitter,
    responseGenerator,
    userPreferencesService,
    researcher,
    searchService,
    storage,
    modelRegistry,
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
    : new LLMBoundaryExtractor(ai, configResolver)
  const boundaryExtractionService = new BoundaryExtractionService(pool, boundaryExtractor)
  const boundaryExtractionWorker = createBoundaryExtractionWorker({ service: boundaryExtractionService })
  jobQueue.registerHandler(JobQueues.BOUNDARY_EXTRACT, boundaryExtractionWorker)

  // Memo (GAM) processing
  const memoService = config.useStubAI
    ? new StubMemoService()
    : new MemoService({
        pool,
        classifier: new MemoClassifier(ai, configResolver, messageFormatter),
        memorizer: new Memorizer(ai, configResolver, messageFormatter),
        embeddingService,
        messageFormatter,
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

  // Image captioning worker
  const imageCaptionService = config.useStubAI
    ? new StubImageCaptionService(pool)
    : new ImageCaptionService({ pool, ai, storage })
  const imageCaptionWorker = createImageCaptionWorker({ imageCaptionService })
  const imageCaptionOnDLQ: OnDLQHook<ImageCaptionJobData> = async (querier, job) => {
    await AttachmentRepository.updateProcessingStatus(querier, job.data.attachmentId, ProcessingStatuses.FAILED)
  }
  jobQueue.registerHandler(JobQueues.IMAGE_CAPTION, imageCaptionWorker, {
    hooks: { onDLQ: imageCaptionOnDLQ },
  })

  // PDF processing workers
  const pdfProcessingService = config.useStubAI
    ? new StubPdfProcessingService({ pool })
    : new PdfProcessingService({ pool, ai, storage, jobQueue })
  const pdfPrepareWorker = createPdfPrepareWorker({ pdfProcessingService })
  const pdfPageWorker = createPdfPageWorker({ pdfProcessingService })
  const pdfAssembleWorker = createPdfAssembleWorker({ pdfProcessingService })
  const pdfOnDLQ: OnDLQHook<PdfPrepareJobData | PdfProcessPageJobData | PdfAssembleJobData> = async (querier, job) => {
    await AttachmentRepository.updateProcessingStatus(querier, job.data.attachmentId, ProcessingStatuses.FAILED)
  }
  jobQueue.registerHandler(JobQueues.PDF_PREPARE, pdfPrepareWorker, {
    hooks: { onDLQ: pdfOnDLQ as OnDLQHook<PdfPrepareJobData> },
  })
  jobQueue.registerHandler(JobQueues.PDF_PROCESS_PAGE, pdfPageWorker, {
    hooks: { onDLQ: pdfOnDLQ as OnDLQHook<PdfProcessPageJobData> },
  })
  jobQueue.registerHandler(JobQueues.PDF_ASSEMBLE, pdfAssembleWorker, {
    hooks: { onDLQ: pdfOnDLQ as OnDLQHook<PdfAssembleJobData> },
  })

  // Text processing worker
  const textProcessingService = config.useStubAI
    ? new StubTextProcessingService({ pool })
    : new TextProcessingService({ pool, ai, storage })
  const textProcessingWorker = createTextProcessingWorker({ textProcessingService })
  const textOnDLQ: OnDLQHook<TextProcessJobData> = async (querier, job) => {
    await AttachmentRepository.updateProcessingStatus(querier, job.data.attachmentId, ProcessingStatuses.FAILED)
  }
  jobQueue.registerHandler(JobQueues.TEXT_PROCESS, textProcessingWorker, {
    hooks: { onDLQ: textOnDLQ },
  })

  // Word processing worker
  const wordProcessingService = config.useStubAI
    ? new StubWordProcessingService({ pool })
    : new WordProcessingService({ pool, ai, storage })
  const wordProcessingWorker = createWordProcessingWorker({ wordProcessingService })
  const wordOnDLQ: OnDLQHook<WordProcessJobData> = async (querier, job) => {
    await AttachmentRepository.updateProcessingStatus(querier, job.data.attachmentId, ProcessingStatuses.FAILED)
  }
  jobQueue.registerHandler(JobQueues.WORD_PROCESS, wordProcessingWorker, {
    hooks: { onDLQ: wordOnDLQ },
  })

  // Excel processing worker
  const excelProcessingService = config.useStubAI
    ? new StubExcelProcessingService({ pool })
    : new ExcelProcessingService({ pool, ai, storage })
  const excelProcessingWorker = createExcelProcessingWorker({ excelProcessingService })
  const excelOnDLQ: OnDLQHook<ExcelProcessJobData> = async (querier, job) => {
    await AttachmentRepository.updateProcessingStatus(querier, job.data.attachmentId, ProcessingStatuses.FAILED)
  }
  jobQueue.registerHandler(JobQueues.EXCEL_PROCESS, excelProcessingWorker, {
    hooks: { onDLQ: excelOnDLQ },
  })

  // Register handlers before starting
  await jobQueue.start()

  // Start schedule manager, cleanup worker, and metrics collectors
  scheduleManager.start()
  cleanupWorker.start()
  agentSessionMetrics.start()

  // Schedule memo batch check cron job (every 30 seconds)
  // workspaceId in payload: "system" for system-wide batch check
  // workspaceId in schedule: null for global (not workspace-specific) schedule
  // Skip when AI is stubbed - stub memo services don't need batch processing
  if (!config.useStubAI) {
    await jobQueue.schedule(JobQueues.MEMO_BATCH_CHECK, 30, { workspaceId: "system" }, null)
  }

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
  const attachmentUploadedHandler = new AttachmentUploadedHandler(pool, jobQueue)

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
  await attachmentUploadedHandler.ensureListener()

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
  outboxDispatcher.register(attachmentUploadedHandler)

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
    // In fast shutdown mode, skip graceful shutdown for immediate termination
    if (config.fastShutdown) {
      logger.info("Fast shutdown mode - skipping graceful shutdown")
      // Force close everything immediately without waiting
      server.close()
      io.close()
      // Skip pool cleanup entirely - process exit will terminate connections
      return
    }

    logger.info("Shutting down server...")
    poolMonitor.stop()
    orphanSessionCleanup.stop()
    agentSessionMetrics.stop()
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

  return { server, io, pools, jobQueue, poolMonitor, port: config.port, fastShutdown: config.fastShutdown, stop }
}
