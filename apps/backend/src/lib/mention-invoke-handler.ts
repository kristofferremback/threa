import type { Pool } from "pg"
import { OutboxRepository } from "../repositories"
import { PersonaRepository } from "../repositories/persona-repository"
import { parseMessageCreatedPayload } from "./outbox-payload-parsers"
import { AuthorTypes } from "@threa/types"
import { extractMentionSlugs } from "./mention-extractor"
import { logger } from "./logger"
import { JobQueueManager, JobQueues } from "./job-queue"
import { CursorLock, ensureListenerFromLatest, type ProcessResult } from "./cursor-lock"
import { DebounceWithMaxWait } from "./debounce"
import type { OutboxHandler } from "./outbox-dispatcher"
import { withClient } from "../db"

export interface MentionInvokeHandlerConfig {
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
 * Handler that invokes personas when @mentioned in messages.
 *
 * Behavior by stream type:
 * - Channel: Agent creates a thread on the message, persona responds there
 * - Thread: Persona responds directly in the thread
 * - Scratchpad: Persona responds directly in the scratchpad
 * - DM: Persona responds directly in the DM
 *
 * Note: Thread creation for channels is handled by the PersonaAgent, not this handler.
 */
export class MentionInvokeHandler implements OutboxHandler {
  readonly listenerId = "mention-invoke"

  private readonly db: Pool
  private readonly jobQueue: JobQueueManager
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, jobQueue: JobQueueManager, config?: MentionInvokeHandlerConfig) {
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
      (err) => logger.error({ err, listenerId: this.listenerId }, "MentionInvokeHandler debouncer error")
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
      const events = await withClient(this.db, (client) =>
        OutboxRepository.fetchAfterId(client, cursor, this.batchSize)
      )

      if (events.length === 0) {
        return { status: "no_events" }
      }

      let lastProcessedId = cursor

      try {
        for (const event of events) {
          if (event.eventType !== "message:created") {
            lastProcessedId = event.id
            continue
          }

          const payload = await parseMessageCreatedPayload(event.payload, this.db)
          if (!payload) {
            logger.debug({ eventId: event.id.toString() }, "MentionInvokeHandler: malformed event, skipping")
            lastProcessedId = event.id
            continue
          }

          const { streamId, workspaceId, event: messageEvent } = payload

          // Ignore persona messages (avoid infinite loops)
          if (messageEvent.actorType !== AuthorTypes.USER) {
            lastProcessedId = event.id
            continue
          }

          // Guard against missing actorId
          if (!messageEvent.actorId) {
            logger.warn({ streamId }, "MentionInvokeHandler: USER message has no actorId, skipping")
            lastProcessedId = event.id
            continue
          }

          const triggeredBy = messageEvent.actorId

          // Extract @mentions from message content
          const mentionSlugs = extractMentionSlugs(messageEvent.payload.contentMarkdown)
          if (mentionSlugs.length === 0) {
            lastProcessedId = event.id
            continue
          }

          // Dispatch job for each mentioned persona
          for (const slug of mentionSlugs) {
            const persona = await withClient(this.db, (client) =>
              PersonaRepository.findBySlug(client, slug, workspaceId)
            )

            // Skip if not a persona (could be a user mention) or if inactive
            if (!persona || persona.status !== "active") {
              continue
            }

            logger.info(
              {
                streamId,
                messageId: messageEvent.payload.messageId,
                personaId: persona.id,
                personaSlug: persona.slug,
              },
              "Persona agent job dispatched (mention trigger)"
            )

            await this.jobQueue.send(JobQueues.PERSONA_AGENT, {
              workspaceId,
              streamId,
              messageId: messageEvent.payload.messageId,
              personaId: persona.id,
              triggeredBy,
              trigger: "mention",
            })
          }

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
