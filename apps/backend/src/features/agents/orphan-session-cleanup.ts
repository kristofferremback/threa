import type { Pool } from "pg"
import { AgentSessionRepository, SessionStatuses } from "./session-repository"
import { logger } from "../../lib/logger"

export interface OrphanSessionCleanup {
  start(): void
  stop(): void
}

/**
 * Periodically cleans up orphaned agent sessions.
 *
 * Sessions can become orphaned if:
 * - Server crashes during AI work
 * - completeSession() fails after work succeeded
 * - Process killed without graceful shutdown
 *
 * The cleanup marks these sessions as FAILED so the stream is unblocked
 * for new requests.
 */
export function createOrphanSessionCleanup(
  pool: Pool,
  options: {
    intervalMs?: number
    staleThresholdSeconds?: number
  } = {}
): OrphanSessionCleanup {
  const { intervalMs = 15_000, staleThresholdSeconds = 60 } = options

  let timer: ReturnType<typeof setInterval> | null = null

  const cleanup = async () => {
    try {
      const orphaned = await AgentSessionRepository.findOrphaned(pool, staleThresholdSeconds)

      if (orphaned.length === 0) return

      logger.info({ count: orphaned.length }, "Found orphaned sessions, marking as failed")

      for (const session of orphaned) {
        try {
          await AgentSessionRepository.updateStatus(pool, session.id, SessionStatuses.FAILED, {
            error: "Session orphaned (stale heartbeat)",
          })
          logger.info({ sessionId: session.id, streamId: session.streamId }, "Marked orphaned session as failed")
        } catch (err) {
          logger.error({ err, sessionId: session.id }, "Failed to mark orphaned session as failed")
        }
      }
    } catch (err) {
      logger.error({ err }, "Error during orphan session cleanup")
    }
  }

  return {
    start() {
      if (timer) return
      logger.info({ intervalMs, staleThresholdSeconds }, "Starting orphan session cleanup")
      timer = setInterval(cleanup, intervalMs)
      // Run immediately on start to catch any orphans from previous crash
      cleanup()
    },

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
        logger.info("Stopped orphan session cleanup")
      }
    },
  }
}
