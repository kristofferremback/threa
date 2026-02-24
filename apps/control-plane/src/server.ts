import { createServer, type Server } from "http"
import {
  createDatabasePool,
  runMigrations,
  WorkosAuthService,
  StubAuthService,
  WorkosOrgServiceImpl,
  StubWorkosOrgService,
  logger,
} from "@threa/backend-common"
import type { Pool } from "pg"
import path from "path"
import { createApp } from "./app"
import { registerRoutes } from "./routes"
import { loadControlPlaneConfig, type ControlPlaneConfig } from "./config"
import { RegionalClient } from "./lib/regional-client"
import { CloudflareKvClient, NoopKvClient, type KvClient } from "./lib/cloudflare-kv-client"
import { TaskProcessor } from "./lib/task-processor"
import { ControlPlaneWorkspaceService, TASK_KV_SYNC } from "./features/workspaces"
import { InvitationShadowService } from "./features/invitation-shadows"

const MIGRATIONS_GLOB = path.join(import.meta.dirname, "db/migrations/*.sql")

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

  // Task processor — durable async work queue
  const taskProcessor = new TaskProcessor({ pool })
  taskProcessor.registerHandler(TASK_KV_SYNC, async (payload) => {
    const { workspaceId, region } = payload as { workspaceId: string; region: string }
    await kvClient.putWorkspaceRegion(workspaceId, region)
  })
  taskProcessor.start()

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
      await taskProcessor.stop()
      await pool.end()
      return
    }

    logger.info("Shutting down control plane...")
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    }
    await taskProcessor.stop()
    await pool.end()
    logger.info("Control plane stopped")
  }

  return { server, pool, port: config.port, fastShutdown: config.fastShutdown, stop }
}
