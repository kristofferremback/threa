import type { Pool } from "pg"
import { OutboxRepository } from "../../repositories"
import { StreamRepository } from "../../repositories"
import { PersonaRepository } from "./persona-repository"
import { AgentSessionRepository, SessionStatuses } from "./session-repository"
import { parseMessageCreatedPayload } from "../../lib/outbox-payload-parsers"
import { AuthorTypes, CompanionModes } from "@threa/types"
import { logger } from "../../lib/logger"
import { JobQueues } from "../../lib/job-queue"
import type { QueueManager } from "../../lib/queue-manager"
import { CursorLock, ensureListenerFromLatest, type ProcessResult } from "../../lib/cursor-lock"
import { DebounceWithMaxWait } from "../../lib/debounce"
import type { OutboxHandler } from "../../lib/outbox-dispatcher"

export interface CompanionHandlerConfig {
  batchSize?: number
  debounceMs?: number
  maxWaitMs?: number
  lockDurationMs?: number
  refreshIntervalMs?: number
  maxRetries?: number
  baseBackoffMs?: number
}

const DEFAULT_CONFIG = {
  batchSize: 100,
  debounceMs: 50,
  maxWaitMs: 200,
  lockDurationMs: 10_000,
  refreshIntervalMs: 5_000,
  maxRetries: 5,
  baseBackoffMs: 1_000,
}

/**
 * Handler that dispatches agentic jobs for messages in streams
 * with companion mode enabled.
 *
 * Flow:
 * 1. Message arrives (via outbox)
 * 2. Check if it's a user message (not persona response)
 * 3. Check if stream has companion mode = 'on'
 * 4. Dispatch queue job for persona agent
 *
 * Uses time-based cursor locking for exclusive access without
 * holding database connections during processing.
 */
export class CompanionHandler implements OutboxHandler {
  readonly listenerId = "companion"

  private readonly db: Pool
  private readonly jobQueue: QueueManager
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, jobQueue: QueueManager, config?: CompanionHandlerConfig) {
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
      (err) => logger.error({ err, listenerId: this.listenerId }, "CompanionHandler debouncer error")
    )
  }

  async ensureListener(): Promise<void> {
    await ensureListenerFromLatest(this.db, this.listenerId)
  }

  handle(): void {
    this.debouncer.trigger()
  }

  private async processEvents(): Promise<void> {
    await this.cursorLock.run(async (cursor): Promise<ProcessResult> => {
      const events = await OutboxRepository.fetchAfterId(this.db, cursor, this.batchSize)

      if (events.length === 0) {
        return { status: "no_events" }
      }

      let lastProcessedId = cursor

      try {
        for (const event of events) {
          // Only process message:created events
          if (event.eventType !== "message:created") {
            lastProcessedId = event.id
            continue
          }

          const payload = parseMessageCreatedPayload(event.payload)
          if (!payload) {
            logger.debug({ eventId: event.id.toString() }, "CompanionHandler: malformed event, skipping")
            lastProcessedId = event.id
            continue
          }

          const { streamId, event: messageEvent } = payload

          // Ignore persona messages (avoid infinite loops)
          if (messageEvent.actorType !== AuthorTypes.MEMBER) {
            lastProcessedId = event.id
            continue
          }

          // Guard against missing actorId (should always exist for USER messages)
          if (!messageEvent.actorId) {
            logger.warn({ streamId }, "CompanionHandler: MEMBER message has no actorId, skipping")
            lastProcessedId = event.id
            continue
          }

          const triggeredBy = messageEvent.actorId

          // Look up stream to check companion mode
          const stream = await StreamRepository.findById(this.db, streamId)
          if (!stream) {
            logger.warn({ streamId }, "CompanionHandler: stream not found")
            lastProcessedId = event.id
            continue
          }

          if (stream.companionMode !== CompanionModes.ON) {
            lastProcessedId = event.id
            continue
          }

          // Resolve persona: use stream's configured persona, or fall back to system default
          let persona = stream.companionPersonaId
            ? await PersonaRepository.findById(this.db, stream.companionPersonaId!)
            : null

          // If configured persona is missing or inactive, try system default
          if (!persona || persona.status !== "active") {
            persona = await PersonaRepository.getSystemDefault(this.db)
          }

          if (!persona) {
            logger.warn({ streamId }, "Companion mode on but no active persona available")
            lastProcessedId = event.id
            continue
          }

          // Check if there's an existing session that will handle this message
          const lastSession = await AgentSessionRepository.findLatestByStream(this.db, streamId)

          if (lastSession) {
            const messageSequence = BigInt(messageEvent.sequence)

            // If a session is still running or pending, it will pick up new messages
            // via check_new_messages node in the graph - don't dispatch duplicate jobs
            if (lastSession.status === SessionStatuses.PENDING || lastSession.status === SessionStatuses.RUNNING) {
              logger.debug(
                {
                  streamId,
                  messageId: messageEvent.payload.messageId,
                  sessionId: lastSession.id,
                  sessionStatus: lastSession.status,
                },
                "Session already active for stream, new message will be handled in-flight"
              )
              lastProcessedId = event.id
              continue
            }

            // If session completed, check if it already saw this message
            if (lastSession.status === SessionStatuses.COMPLETED && lastSession.lastSeenSequence) {
              if (messageSequence <= lastSession.lastSeenSequence) {
                logger.debug(
                  {
                    streamId,
                    messageId: messageEvent.payload.messageId,
                    messageSequence: messageSequence.toString(),
                    lastSeenSequence: lastSession.lastSeenSequence.toString(),
                  },
                  "Message already seen by previous session, skipping"
                )
                lastProcessedId = event.id
                continue
              }
            }
          }

          logger.info(
            { streamId, messageId: messageEvent.payload.messageId, personaId: persona.id },
            "Persona agent job dispatched (companion mode)"
          )

          await this.jobQueue.send(JobQueues.PERSONA_AGENT, {
            workspaceId: stream.workspaceId,
            streamId,
            messageId: messageEvent.payload.messageId,
            personaId: persona.id,
            triggeredBy,
          })

          lastProcessedId = event.id
        }

        return { status: "processed", newCursor: events[events.length - 1].id }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))

        if (lastProcessedId > cursor) {
          return { status: "error", error, newCursor: lastProcessedId }
        }

        return { status: "error", error }
      }
    })
  }
}
