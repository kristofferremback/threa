import type { Pool } from "pg"
import { withTransaction } from "../../../db"
import { AgentSessionRepository, SessionStatuses, type AgentSession } from "../session-repository"
import { OutboxRepository } from "../../../lib/outbox"
import { StreamEventRepository } from "../../streams"
import { eventId, sessionId } from "../../../lib/id"
import { logger } from "../../../lib/logger"

export type WithSessionResult =
  | { status: "skipped"; sessionId: null; reason: string }
  | { status: "completed"; sessionId: string; messagesSent: number; sentMessageIds: string[]; lastSeenSequence: bigint }
  | { status: "failed"; sessionId: string }

/**
 * Manages the complete lifecycle of an agent session.
 *
 * Connection lifecycle (INV-41):
 * 1. Phase 1: Acquire connection -> atomically create/find session -> release
 * 2. Phase 2: Run work (AI call) WITHOUT holding connection
 * 3. Phase 3: Acquire connection -> atomically complete session -> release
 *
 * Race condition prevention:
 * - Uses a partial unique index (stream_id WHERE status='running') to ensure
 *   only one running session per stream
 * - INSERT with ON CONFLICT DO NOTHING atomically checks and creates
 */
export async function withCompanionSession(
  params: {
    pool: Pool
    triggerMessageId: string
    streamId: string
    personaId: string
    personaName: string
    workspaceId: string
    serverId: string
    initialSequence: bigint
  },
  work: (
    session: AgentSession,
    pool: Pool
  ) => Promise<{ messagesSent: number; sentMessageIds: string[]; lastSeenSequence: bigint }>
): Promise<WithSessionResult> {
  const { pool, triggerMessageId, streamId, personaId, personaName, workspaceId, serverId, initialSequence } = params

  // Phase 1: Session setup (short-lived transaction)
  const setupResult = await withTransaction(pool, async (db) => {
    const existingSession = await AgentSessionRepository.findByTriggerMessage(db, triggerMessageId)

    if (existingSession?.status === SessionStatuses.COMPLETED) {
      logger.info({ sessionId: existingSession.id }, "Session already completed")
      return { status: "skipped" as const, sessionId: null, reason: "session already completed" }
    }

    if (existingSession) {
      const session = await AgentSessionRepository.updateStatus(db, existingSession.id, SessionStatuses.RUNNING, {
        serverId,
      })
      if (!session) {
        return { status: "skipped" as const, sessionId: null, reason: "failed to resume session" }
      }
      return { status: "ready" as const, session }
    }

    const session = await AgentSessionRepository.insertRunningOrSkip(db, {
      id: sessionId(),
      streamId,
      personaId,
      triggerMessageId,
      serverId,
      initialSequence,
    })

    if (!session) {
      logger.info({ streamId }, "Agent already running for stream (concurrent insert), skipping")
      return { status: "skipped" as const, sessionId: null, reason: "agent already running for stream" }
    }

    const streamEvent = await StreamEventRepository.insert(db, {
      id: eventId(),
      streamId,
      eventType: "agent_session:started",
      payload: {
        sessionId: session.id,
        personaId,
        personaName,
        triggerMessageId,
        startedAt: session.createdAt.toISOString(),
      },
      actorId: personaId,
      actorType: "persona",
    })
    await OutboxRepository.insert(db, "agent_session:started", {
      workspaceId,
      streamId,
      event: streamEvent,
    })

    return { status: "ready" as const, session }
  })

  if (setupResult.status === "skipped") {
    return setupResult
  }

  const { session } = setupResult

  // Phase 2: Run work WITHOUT holding connection
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined

  try {
    heartbeatInterval = setInterval(async () => {
      try {
        await AgentSessionRepository.updateHeartbeat(pool, session.id)
      } catch (err) {
        logger.warn({ err, sessionId: session.id }, "Heartbeat update failed")
      }
    }, 15_000)

    const { messagesSent, sentMessageIds, lastSeenSequence } = await work(session, pool)

    // Phase 3: Complete session + emit completed event atomically
    try {
      await withTransaction(pool, async (db) => {
        const completed = await AgentSessionRepository.completeSession(db, session.id, {
          lastSeenSequence,
          responseMessageId: sentMessageIds[0] ?? null,
          sentMessageIds,
        })

        const steps = await AgentSessionRepository.findStepsBySession(db, session.id)
        const completedAt = completed?.completedAt ?? new Date()
        const duration = completedAt.getTime() - session.createdAt.getTime()

        const streamEvent = await StreamEventRepository.insert(db, {
          id: eventId(),
          streamId,
          eventType: "agent_session:completed",
          payload: {
            sessionId: session.id,
            stepCount: steps.length,
            messageCount: sentMessageIds.length,
            duration,
            completedAt: completedAt.toISOString(),
          },
          actorId: personaId,
          actorType: "persona",
        })
        await OutboxRepository.insert(db, "agent_session:completed", {
          workspaceId,
          streamId,
          event: streamEvent,
        })
      })
    } catch (err) {
      logger.error({ err, sessionId: session.id }, "Failed to complete session, orphan cleanup will recover")
      throw err
    }

    logger.info({ sessionId: session.id, messagesSent, sentMessageIds }, "Session completed")

    return {
      status: "completed" as const,
      sessionId: session.id,
      messagesSent,
      sentMessageIds,
      lastSeenSequence,
    }
  } catch (err) {
    logger.error({ err, sessionId: session.id }, "Session failed")

    await withTransaction(pool, async (db) => {
      const failed = await AgentSessionRepository.updateStatus(db, session.id, SessionStatuses.FAILED, {
        error: String(err),
      })
      if (failed) {
        const steps = await AgentSessionRepository.findStepsBySession(db, session.id)

        const streamEvent = await StreamEventRepository.insert(db, {
          id: eventId(),
          streamId,
          eventType: "agent_session:failed",
          payload: {
            sessionId: session.id,
            stepCount: steps.length,
            error: String(err),
            traceId: session.id,
            failedAt: new Date().toISOString(),
          },
          actorId: personaId,
          actorType: "persona",
        })
        await OutboxRepository.insert(db, "agent_session:failed", {
          workspaceId,
          streamId,
          event: streamEvent,
        })
      }
    }).catch((e) => logger.error({ err: e }, "Failed to mark session as failed"))

    return { status: "failed" as const, sessionId: session.id }
  } finally {
    if (heartbeatInterval) clearInterval(heartbeatInterval)
  }
}
