import { createServer, type Server } from "http"
import {
  createDatabasePool,
  runMigrations,
  WorkosAuthService,
  StubAuthService,
  WorkosOrgServiceImpl,
  StubWorkosOrgService,
  OutboxDispatcher,
  OutboxRepository,
  CursorLock,
  DebounceWithMaxWait,
  ensureListenerFromLatest,
  logger,
  type OutboxEvent,
  type ProcessResult,
} from "@threa/backend-common"
import type { Pool } from "pg"
import path from "path"
import { createApp } from "./app"
import { registerRoutes } from "./routes"
import { loadControlPlaneConfig } from "./config"
import { RegionalClient } from "./lib/regional-client"
import { CloudflareKvClient, NoopKvClient, type KvClient } from "./lib/cloudflare-kv-client"
import {
  ControlPlaneWorkspaceService,
  OUTBOX_KV_SYNC,
  OUTBOX_REGIONAL_CREATE,
  type KvSyncPayload,
  type RegionalCreatePayload,
} from "./features/workspaces"
import { InvitationShadowService } from "./features/invitation-shadows"
import { BackofficeService, seedPlatformAdmins, reconcilePlatformAdminsAcrossRegions } from "./features/backoffice"

const MIGRATIONS_GLOB = path.join(import.meta.dirname, "db/migrations/*.sql")
const LISTENER_ID = "control-plane"

export interface ControlPlaneInstance {
  server: Server
  pool: Pool
  port: number
  fastShutdown: boolean
  stop: () => Promise<void>
}

export async function startServer(): Promise<ControlPlaneInstance> {
  const config = loadControlPlaneConfig()

  const pool = createDatabasePool(config.databaseUrl, { max: 10 })
  const listenPool = createDatabasePool(config.databaseUrl, { max: 2, idleTimeoutMillis: 60_000 })
  await runMigrations(pool, MIGRATIONS_GLOB)
  logger.info("Control plane database migrations complete")

  const authService = config.useStubAuth ? new StubAuthService() : new WorkosAuthService(config.workos)
  const workosOrgService = config.useStubAuth ? new StubWorkosOrgService() : new WorkosOrgServiceImpl(config.workos)

  const regionalClient = new RegionalClient(config.regions, config.internalApiKey)
  const kvClient: KvClient = config.cloudflareKv ? new CloudflareKvClient(config.cloudflareKv) : new NoopKvClient()

  const availableRegions = Object.keys(config.regions)
  const workspaceService = new ControlPlaneWorkspaceService({
    pool,
    regionalClient,
    workosOrgService,
    kvClient,
    availableRegions,
    requireWorkspaceCreationInvite: config.workspaceCreationRequiresInvite,
  })
  const shadowService = new InvitationShadowService({ pool, regionalClient, workosOrgService })
  const backofficeService = new BackofficeService({
    pool,
    workosOrgService,
    workspaceAppBaseUrl: config.frontendUrl,
    workosEnvironmentId: config.workosEnvironmentId,
  })
  await seedPlatformAdmins(pool, config.platformAdminWorkosUserIds)
  // Fan out platform-admin flags to every region each admin has a workspace
  // in. Best-effort — per-region failures are logged, next boot retries.
  await reconcilePlatformAdminsAcrossRegions(pool, regionalClient)

  // Outbox — single handler for all control-plane events (no sharding needed)
  const cursorLock = new CursorLock({
    pool,
    listenerId: LISTENER_ID,
    lockDurationMs: 10_000,
    refreshIntervalMs: 5_000,
    maxRetries: 5,
    baseBackoffMs: 1_000,
    batchSize: 50,
  })

  const processEvents = async () => {
    await cursorLock.run(async (cursor, processedIds) => {
      const events = await OutboxRepository.fetchAfterId(pool, cursor, cursorLock.batchSize, processedIds)
      if (events.length === 0) return { status: "no_events" } as ProcessResult

      const seen: bigint[] = []
      let lastError: Error | undefined
      for (const event of events) {
        try {
          await dispatchEvent(event, { workspaceService })
          seen.push(event.id)
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          logger.error({ err, eventId: event.id, eventType: event.eventType }, "Outbox event processing failed")
        }
      }
      // Signal error to CursorLock so it applies backoff + DLQ for poison events,
      // while still saving partial progress for successfully processed events.
      if (lastError) {
        return { status: "error", error: lastError, processedIds: seen } as ProcessResult
      }
      return { status: "processed", processedIds: seen } as ProcessResult
    })
  }

  const debouncer = new DebounceWithMaxWait(processEvents, 50, 200, (err) => {
    logger.error({ err }, "Control-plane outbox handler error")
  })

  const outboxHandler = {
    listenerId: LISTENER_ID,
    handle: () => debouncer.trigger(),
  }

  await ensureListenerFromLatest(pool, LISTENER_ID)
  const outboxDispatcher = new OutboxDispatcher({ listenPool })
  outboxDispatcher.register(outboxHandler)
  await outboxDispatcher.start()

  const isProduction = process.env.NODE_ENV === "production"
  const app = createApp({ corsAllowedOrigins: config.corsAllowedOrigins })

  registerRoutes(app, {
    authService,
    workspaceService,
    shadowService,
    backofficeService,
    internalApiKey: config.internalApiKey,
    allowDevAuthRoutes: config.useStubAuth && !isProduction,
    frontendUrl: config.frontendUrl,
    allowedRedirectDomain: config.allowedRedirectDomain,
    regions: config.regions,
    workosDedicatedRedirectHosts: config.workosDedicatedRedirectHosts,
    rateLimits: config.rateLimits,
  })

  const server = createServer(app)

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(config.port, "0.0.0.0", () => {
      server.removeListener("error", reject)
      logger.info({ port: config.port }, "Control plane started")
      resolve()
    })
  })

  const stop = async () => {
    if (config.fastShutdown) {
      logger.info("Fast shutdown - skipping graceful shutdown")
      server.close()
      await outboxDispatcher.stop()
      await listenPool.end()
      await pool.end()
      return
    }

    logger.info("Shutting down control plane...")
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    }
    await outboxDispatcher.stop()
    await listenPool.end()
    await pool.end()
    logger.info("Control plane stopped")
  }

  return { server, pool, port: config.port, fastShutdown: config.fastShutdown, stop }
}

/** Dispatch a single outbox event to the appropriate service method (INV-34) */
async function dispatchEvent(
  event: OutboxEvent,
  deps: { workspaceService: ControlPlaneWorkspaceService }
): Promise<void> {
  const payload = event.payload as unknown
  switch (event.eventType) {
    case OUTBOX_REGIONAL_CREATE:
      await deps.workspaceService.provisionRegional(payload as RegionalCreatePayload)
      break
    case OUTBOX_KV_SYNC:
      await deps.workspaceService.syncToKv(payload as KvSyncPayload)
      break
    default:
      logger.warn({ eventType: event.eventType }, "Unknown outbox event type")
  }
}
