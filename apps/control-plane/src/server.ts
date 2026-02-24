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
  withTransaction,
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
import { ControlPlaneWorkspaceService, OUTBOX_KV_SYNC } from "./features/workspaces"
import { InvitationShadowService, OUTBOX_SHADOW_ACCEPT } from "./features/invitation-shadows"
import { InvitationShadowRepository } from "./features/invitation-shadows"
import { WorkspaceRegistryRepository } from "./features/workspaces"

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
    availableRegions,
    requireWorkspaceCreationInvite: config.workspaceCreationRequiresInvite,
  })
  const shadowService = new InvitationShadowService({ pool, regionalClient })

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
      for (const event of events) {
        await handleEvent(event, { kvClient, regionalClient, pool })
        seen.push(event.id)
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
    internalApiKey: config.internalApiKey,
    allowDevAuthRoutes: config.useStubAuth && !isProduction,
    rateLimits: config.rateLimits,
  })

  const server = createServer(app)

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(config.port, () => {
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

async function handleEvent(
  event: OutboxEvent,
  deps: { kvClient: KvClient; regionalClient: RegionalClient; pool: Pool }
): Promise<void> {
  const { kvClient, regionalClient, pool } = deps
  const payload = event.payload

  switch (event.eventType) {
    case OUTBOX_KV_SYNC: {
      const { workspaceId, region } = payload as { workspaceId: string; region: string }
      await kvClient.putWorkspaceRegion(workspaceId, region)
      break
    }
    case OUTBOX_SHADOW_ACCEPT: {
      const { shadowId, workspaceId, region, workosUserId, email, name } = payload as {
        shadowId: string
        workspaceId: string
        region: string
        workosUserId: string
        email: string
        name: string
      }
      await regionalClient.acceptInvitation(region, shadowId, { workosUserId, email, name })
      await withTransaction(pool, async (client) => {
        await InvitationShadowRepository.updateStatus(client, shadowId, "accepted")
        await WorkspaceRegistryRepository.insertMembership(client, workspaceId, workosUserId)
      })
      break
    }
    default:
      logger.warn({ eventType: event.eventType }, "Unknown outbox event type")
  }
}
