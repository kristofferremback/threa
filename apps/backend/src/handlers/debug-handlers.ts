import type { Request, Response } from "express"
import type { Pool } from "pg"
import type { PoolMonitor } from "../lib/pool-monitor"

interface Dependencies {
  pool: Pool
  poolMonitor: PoolMonitor
}

export function createDebugHandlers({ pool, poolMonitor }: Dependencies) {
  return {
    /**
     * Internal readiness endpoint.
     *
     * GET /readyz
     */
    readiness(_req: Request, res: Response) {
      const poolStats = poolMonitor.getAllPoolStats()
      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        pools: poolStats,
      })
    },

    /**
     * Inspect pool internal state for debugging connection issues.
     *
     * GET /debug/pool
     */
    poolState(_req: Request, res: Response) {
      const mainPool = pool as any

      const clients =
        mainPool._clients?.map((client: any, index: number) => ({
          index,
          connected: client._connected,
          connecting: client._connecting,
          ending: client._ending,
          queryable: client._queryable,
        })) ?? []

      const idle =
        mainPool._idle?.map((item: any) => ({
          connected: item.client._connected,
        })) ?? []

      res.json({
        publicStats: {
          totalCount: mainPool.totalCount,
          idleCount: mainPool.idleCount,
          waitingCount: mainPool.waitingCount,
        },
        internals: {
          _clients_length: mainPool._clients?.length,
          _idle_length: mainPool._idle?.length,
          _pendingQueue_length: mainPool._pendingQueue?.length,
        },
        clients,
        idle,
      })
    },

    /**
     * Prometheus metrics endpoint.
     *
     * GET /metrics
     */
    async metrics(_req: Request, res: Response) {
      const { registry } = await import("../lib/metrics")
      res.set("Content-Type", registry.contentType)
      res.end(await registry.metrics())
    },
  }
}
