import type { Pool } from "pg"
import type { OutboxHandler } from "../../lib/outbox"
import { OutboxRepository, isOneOfOutboxEventType } from "../../lib/outbox"
import type { QueueManager, ContextBagOrientJobData } from "../../lib/queue"
import { JobQueues, type JobHandler } from "../../lib/queue"
import type { AI } from "../../lib/ai/ai"
import { AgentStepTypes, AuthorTypes, CompanionModes, StreamTypes, type AuthorType } from "@threa/types"
import { logger } from "../../lib/logger"
import { StreamRepository } from "../streams"
import { PersonaRepository } from "./persona-repository"
import { CursorLock, ensureListenerFromLatest, DebounceWithMaxWait, type ProcessResult } from "@threa/backend-common"
import { ContextBagRepository, persistSnapshot, resolveBagForStream, getIntentConfig } from "./context-bag"
import { withCompanionSession } from "./companion"
import type { TraceEmitter } from "./trace-emitter"

export interface ContextBagOrientationHandlerConfig {
  batchSize?: number
  debounceMs?: number
  maxWaitMs?: number
  lockDurationMs?: number
  refreshIntervalMs?: number
  maxRetries?: number
  baseBackoffMs?: number
}

const DEFAULT_CONFIG = {
  batchSize: 50,
  debounceMs: 50,
  maxWaitMs: 250,
  lockDurationMs: 10_000,
  refreshIntervalMs: 5_000,
  maxRetries: 5,
  baseBackoffMs: 1_000,
}

/**
 * Queue name re-exported for readability at dispatch/register sites. The job
 * payload (`ContextBagOrientJobData`) is defined alongside other queue types
 * in `lib/queue/job-queue.ts` for INV-33 (single source of truth).
 */
export const CONTEXT_BAG_ORIENT_QUEUE = JobQueues.CONTEXT_BAG_ORIENT

/**
 * Outbox handler: listens for stream:created events and dispatches an
 * orientation job when the newly-created scratchpad has a context bag +
 * companion mode on. Normal (non-bag) scratchpads stay on the regular
 * "wait for user message" path handled by `CompanionHandler`.
 */
export class ContextBagOrientationHandler implements OutboxHandler {
  readonly listenerId = "context-bag-orientation"

  private readonly db: Pool
  private readonly jobQueue: QueueManager
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, jobQueue: QueueManager, config?: ContextBagOrientationHandlerConfig) {
    this.db = db
    this.jobQueue = jobQueue
    this.batchSize = config?.batchSize ?? DEFAULT_CONFIG.batchSize

    this.cursorLock = new CursorLock({
      pool: db,
      listenerId: this.listenerId,
      lockDurationMs: config?.lockDurationMs ?? DEFAULT_CONFIG.lockDurationMs,
      refreshIntervalMs: config?.refreshIntervalMs ?? DEFAULT_CONFIG.refreshIntervalMs,
      maxRetries: config?.maxRetries ?? DEFAULT_CONFIG.maxRetries,
      baseBackoffMs: config?.baseBackoffMs ?? DEFAULT_CONFIG.baseBackoffMs,
      batchSize: this.batchSize,
    })

    this.debouncer = new DebounceWithMaxWait(
      () => this.processEvents(),
      config?.debounceMs ?? DEFAULT_CONFIG.debounceMs,
      config?.maxWaitMs ?? DEFAULT_CONFIG.maxWaitMs,
      (err) => logger.error({ err, listenerId: this.listenerId }, "ContextBagOrientationHandler debouncer error")
    )
  }

  async ensureListener(): Promise<void> {
    await ensureListenerFromLatest(this.db, this.listenerId)
  }

  handle(): void {
    this.debouncer.trigger()
  }

  private async processEvents(): Promise<void> {
    await this.cursorLock.run(async (cursor, processedIds): Promise<ProcessResult> => {
      const events = await OutboxRepository.fetchAfterId(this.db, cursor, this.batchSize, processedIds)
      if (events.length === 0) return { status: "no_events" }

      const seen: bigint[] = []
      try {
        for (const event of events) {
          if (!isOneOfOutboxEventType(event, ["stream:created"])) {
            seen.push(event.id)
            continue
          }

          const { workspaceId, streamId, stream } = event.payload
          if (stream.type !== StreamTypes.SCRATCHPAD) {
            seen.push(event.id)
            continue
          }
          if (stream.companionMode !== CompanionModes.ON) {
            seen.push(event.id)
            continue
          }

          const bag = await ContextBagRepository.findByStream(this.db, streamId)
          if (!bag) {
            // No bag attached — normal companion-mode scratchpads stay on the
            // "wait for first user message" path (CompanionHandler). Skip.
            seen.push(event.id)
            continue
          }

          const personaId = stream.companionPersonaId
          if (!personaId) {
            logger.warn({ streamId }, "context-bag orientation: scratchpad has bag but no companion persona set")
            seen.push(event.id)
            continue
          }

          await this.jobQueue.send(CONTEXT_BAG_ORIENT_QUEUE, {
            workspaceId,
            streamId,
            bagId: bag.id,
            personaId,
          })
          logger.info({ streamId, bagId: bag.id }, "context-bag orientation job dispatched")
          seen.push(event.id)
        }
        return { status: "processed", processedIds: seen }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        if (seen.length > 0) {
          return { status: "error", error, processedIds: seen }
        }
        return { status: "error", error }
      }
    })
  }
}

export interface ContextBagOrientationWorkerDeps {
  pool: Pool
  ai: AI
  /**
   * Same TraceEmitter used by the persona-agent; we reuse it so the orientation
   * turn shows up in the activity indicator, emits `agent_session:started`/
   * `:completed` on the socket, and produces a real trace UI entry. INV-35:
   * reuse existing helpers.
   */
  traceEmitter: TraceEmitter
  /** Server id persisted on the session row for heartbeat / orphan recovery. */
  serverId: string
  createMessage: (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: AuthorType
    content: string
    sessionId?: string
    /**
     * Idempotency key forwarded to `event-service.createMessage`. If a retry
     * lands in the crash-window (message written, snapshot not), the ON
     * CONFLICT DO NOTHING path on `(stream_id, client_message_id)` returns
     * the existing row rather than posting a duplicate.
     */
    clientMessageId?: string
  }) => Promise<{ id: string }>
}

/**
 * Orientation worker: runs Ariadne's kickoff turn for a newly-created,
 * bag-attached scratchpad. The work is wrapped in `withCompanionSession` so
 * the UI shows an activity indicator, the trace dialog populates in
 * real-time, and session idempotency is handled by the existing
 * (trigger_message_id → session) partial unique index — retries with the
 * same synthetic trigger id (`orient:<bagId>`) see the completed session
 * and bail without re-running the AI call.
 *
 * Crash-window safety:
 * - `withCompanionSession` is the primary idempotency mechanism. A retry
 *   after a fully-completed session finds a COMPLETED row and returns
 *   `skipped` without re-running `work`.
 * - `clientMessageId: orient:<bagId>` is a belt-and-braces guard for the
 *   narrow window where `work` posted the message but the session-
 *   completion transaction failed. The retry re-runs `work` but the
 *   message insert hits ON CONFLICT DO NOTHING on `(stream_id,
 *   client_message_id)` and returns the existing row; `persistSnapshot` is
 *   an idempotent UPDATE so it re-runs safely.
 *
 * Connection lifecycle (INV-41): the AI call runs with no held connection.
 * Resolution, trace step writes, and the final snapshot update each open a
 * short single-query connection.
 */
export function createContextBagOrientationWorker(
  deps: ContextBagOrientationWorkerDeps
): JobHandler<ContextBagOrientJobData> {
  const { pool, ai, createMessage, traceEmitter, serverId } = deps

  return async (job) => {
    const { workspaceId, streamId, bagId, personaId } = job.data
    logger.info({ jobId: job.id, streamId, bagId }, "Processing context-bag orientation job")

    const persona = await PersonaRepository.findById(pool, personaId)
    if (!persona || persona.status !== "active") {
      logger.warn({ streamId, personaId }, "context-bag orientation: persona missing or inactive, skipping")
      return
    }

    const stream = await StreamRepository.findById(pool, streamId)
    if (!stream || stream.workspaceId !== workspaceId) {
      logger.warn({ streamId }, "context-bag orientation: stream missing, skipping")
      return
    }

    // Synthetic trigger id keys the session against this bag. Retries share
    // the same id so `findByTriggerMessage` returns the already-running/
    // completed session and `withCompanionSession` handles all the skip/
    // resume/fail transitions for us.
    const triggerMessageId = `orient:${bagId}`

    const result = await withCompanionSession(
      {
        pool,
        triggerMessageId,
        streamId,
        personaId: persona.id,
        personaName: persona.name,
        workspaceId,
        serverId,
        initialSequence: 0n,
      },
      async (session) => {
        const trace = traceEmitter.forSession({
          sessionId: session.id,
          workspaceId,
          streamId,
          triggerMessageId,
          personaName: persona.name,
        })

        // Step 1: context_received — resolve the bag + narrate what was loaded
        // so the trace UI shows the model's input before the AI call starts.
        // `skipIfAlreadyRendered` turns the bag load inside resolveBagForStream
        // into the only full-bag lookup, dropping the prior double-load.
        const contextStep = await trace.startStep({ stepType: AgentStepTypes.CONTEXT_RECEIVED })
        const resolved = await resolveBagForStream(
          { pool, ai, costContext: { workspaceId, origin: "system" } },
          streamId,
          { skipIfAlreadyRendered: true }
        )
        if (!resolved) {
          await contextStep.complete({ content: "Context already rendered or bag missing — skipping orientation." })
          return { messagesSent: 0, sentMessageIds: [], lastSeenSequence: 0n }
        }
        await contextStep.complete({
          content: JSON.stringify({
            intent: resolved.intent,
            stableChars: resolved.stable.length,
            deltaChars: resolved.delta.length,
          }),
        })

        const intentConfig = getIntentConfig(resolved.intent)
        const systemPrompt = resolved.stable
        const userPrompt = resolved.delta
          ? `${intentConfig.orientationUserPrompt}\n\n${resolved.delta}`
          : intentConfig.orientationUserPrompt

        // Step 2: thinking — the one AI call. Emits a live "thinking" card in
        // the trace UI from start to finish so the user sees progress.
        const parsed = ai.parseModel(persona.model)
        const thinkingStep = await trace.startStep({ stepType: AgentStepTypes.THINKING })
        const aiResult = await ai.generateText({
          model: persona.model,
          telemetry: {
            functionId: "context-bag.orient",
            metadata: {
              intent: resolved.intent,
              model_id: parsed.modelId,
              model_provider: parsed.modelProvider,
              model_name: parsed.modelName,
            },
          },
          context: { workspaceId, origin: "system" },
          temperature: persona.temperature ?? 0.4,
          maxTokens: persona.maxTokens ?? 800,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        })

        const orientText = aiResult.value.trim()
        await thinkingStep.complete({ content: orientText })

        if (!orientText) {
          logger.warn({ streamId, bagId }, "context-bag orientation: empty AI response, skipping post")
          return { messagesSent: 0, sentMessageIds: [], lastSeenSequence: 0n }
        }

        // Step 3: message_sent — post Ariadne's reply. The `clientMessageId`
        // is the crash-window belt-and-braces guard (see class-level comment).
        const message = await createMessage({
          workspaceId,
          streamId,
          authorId: persona.id,
          authorType: AuthorTypes.PERSONA,
          content: orientText,
          sessionId: session.id,
          clientMessageId: `orient:${bagId}`,
        })
        const sentStep = await trace.startStep({ stepType: AgentStepTypes.MESSAGE_SENT })
        await sentStep.complete({ messageId: message.id })

        // Persist the render snapshot so subsequent turns see this state as
        // the baseline when computing the "since last turn" delta. Idempotent
        // UPDATE, safe if a retry runs work twice.
        await persistSnapshot(pool, bagId, resolved.nextSnapshot)

        logger.info({ streamId, bagId, sessionId: session.id }, "context-bag orientation message posted")

        return { messagesSent: 1, sentMessageIds: [message.id], lastSeenSequence: 0n }
      }
    )

    // Fire-and-forget socket notifications; mirrors the persona-agent path.
    if (result.sessionId) {
      const trace = traceEmitter.forSession({
        sessionId: result.sessionId,
        workspaceId,
        streamId,
        triggerMessageId,
        personaName: persona.name,
      })
      if (result.status === "completed") trace.notifyCompleted()
      else if (result.status === "failed") trace.notifyFailed()
    }

    if (result.status === "failed") {
      // Surface to the queue so the retry machinery sees it. The session row
      // is already FAILED so the next retry of the same job can transition it
      // back to RUNNING via withCompanionSession.
      throw new Error(`context-bag orientation session failed for bag ${bagId}`)
    }
  }
}
