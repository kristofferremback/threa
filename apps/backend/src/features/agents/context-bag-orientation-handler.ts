import type { Pool } from "pg"
import type { OutboxHandler } from "../../lib/outbox"
import { OutboxRepository, isOneOfOutboxEventType } from "../../lib/outbox"
import type { QueueManager, ContextBagOrientJobData } from "../../lib/queue"
import { JobQueues, type JobHandler } from "../../lib/queue"
import type { AI } from "../../lib/ai/ai"
import { CompanionModes, StreamTypes, AuthorTypes } from "@threa/types"
import { logger } from "../../lib/logger"
import { StreamRepository } from "../streams"
import { PersonaRepository } from "./persona-repository"
import { CursorLock, ensureListenerFromLatest, DebounceWithMaxWait, type ProcessResult } from "@threa/backend-common"
import { ContextBagRepository, persistSnapshot, resolveBagForStream, getIntentConfig } from "./context-bag"

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
  createMessage: (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: "user" | "persona" | "system" | "bot"
    content: string
    sessionId?: string
  }) => Promise<{ id: string }>
}

/**
 * Orientation worker: runs the actual AI kickoff turn out of the outbox hot
 * path. Resolves the bag (summarizing if needed), calls the AI once, posts
 * Ariadne's first message, then persists the render snapshot.
 *
 * The AI call runs without holding any DB connection (INV-41): resolveBag
 * pulls the data in a short-lived connection, releases it, does the summary
 * call if needed, then releases again. We then acquire a new connection for
 * the message insert + snapshot update.
 */
export function createContextBagOrientationWorker(
  deps: ContextBagOrientationWorkerDeps
): JobHandler<ContextBagOrientJobData> {
  const { pool, ai, createMessage } = deps

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

    const resolved = await resolveBagForStream({ pool, ai, costContext: { workspaceId, origin: "system" } }, streamId)
    if (!resolved) {
      logger.warn({ streamId, bagId }, "context-bag orientation: bag resolution returned null, skipping")
      return
    }

    const intentConfig = getIntentConfig(resolved.intent)

    // One generateText call — no tools, no multi-turn. Uses the persona's
    // configured model so the orientation voice matches subsequent replies.
    const parsed = ai.parseModel(persona.model)
    const systemPrompt = resolved.stable
    const userPrompt = resolved.delta
      ? `${intentConfig.orientationUserPrompt}\n\n${resolved.delta}`
      : intentConfig.orientationUserPrompt

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
    if (!orientText) {
      logger.warn({ streamId, bagId }, "context-bag orientation: empty AI response, skipping post")
      return
    }

    await createMessage({
      workspaceId,
      streamId,
      authorId: persona.id,
      authorType: AuthorTypes.PERSONA,
      content: orientText,
    })

    // Persist the render snapshot so subsequent turns see this state as the
    // baseline when computing the "since last turn" delta. We use a short
    // single-query connection here — the message-write already emitted its
    // own outbox entry, so this is a standalone update.
    await persistSnapshot(pool, bagId, resolved.nextSnapshot)

    logger.info({ streamId, bagId }, "context-bag orientation message posted")
  }
}
