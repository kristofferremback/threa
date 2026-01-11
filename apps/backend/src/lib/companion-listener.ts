import type { PoolClient } from "pg"
import type { DatabasePools } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import { StreamRepository } from "../repositories/stream-repository"
import { PersonaRepository } from "../repositories/persona-repository"
import { AgentSessionRepository, SessionStatuses } from "../repositories/agent-session-repository"
import type { OutboxEvent } from "../repositories/outbox-repository"
import { parseMessageCreatedPayloadWithClient } from "./outbox-payload-parsers"
import { AuthorTypes, CompanionModes } from "@threa/types"
import { logger } from "./logger"
import { job, type HandlerEffect } from "./handler-effects"

/**
 * Creates a companion listener that dispatches agentic jobs for messages
 * in streams with companion mode enabled.
 *
 * Uses pure handler mode for guaranteed at-least-once delivery of pg-boss jobs.
 *
 * Flow:
 * 1. Message arrives (via outbox)
 * 2. Check if it's a user message (not persona response)
 * 3. Check if stream has companion mode = 'on'
 * 4. Return pg-boss job effect (executed atomically with cursor update)
 */
export function createCompanionListener(
  pools: DatabasePools,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "pureHandler" | "jobQueue" | "listenPool" | "queryPool">
): OutboxListener {
  return new OutboxListener({
    ...config,
    listenPool: pools.listen,
    queryPool: pools.main,
    listenerId: "companion",
    jobQueue,
    pureHandler: async (outboxEvent: OutboxEvent, client: PoolClient): Promise<HandlerEffect[]> => {
      // Only process message:created events
      if (outboxEvent.eventType !== "message:created") {
        return []
      }

      const payload = await parseMessageCreatedPayloadWithClient(outboxEvent.payload, client)
      if (!payload) {
        logger.debug({ eventId: outboxEvent.id }, "Companion listener: malformed event, skipping")
        return []
      }

      const { streamId, event } = payload

      // Ignore persona messages (avoid infinite loops)
      if (event.actorType !== AuthorTypes.USER) {
        return []
      }

      // Guard against missing actorId (should always exist for USER messages)
      if (!event.actorId) {
        logger.warn({ streamId }, "Companion listener: USER message has no actorId, skipping")
        return []
      }

      const triggeredBy = event.actorId

      // Look up stream to check companion mode
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        logger.warn({ streamId }, "Companion listener: stream not found")
        return []
      }

      if (stream.companionMode !== CompanionModes.ON) {
        return []
      }

      // Resolve persona: use stream's configured persona, or fall back to system default
      let persona = stream.companionPersonaId
        ? await PersonaRepository.findById(client, stream.companionPersonaId)
        : null

      // If configured persona is missing or inactive, try system default
      if (!persona || persona.status !== "active") {
        persona = await PersonaRepository.getSystemDefault(client)
      }

      if (!persona) {
        logger.warn({ streamId }, "Companion mode on but no active persona available")
        return []
      }

      // Check if there's an existing session that will handle this message
      const lastSession = await AgentSessionRepository.findLatestByStream(client, streamId)
      if (lastSession) {
        const messageSequence = BigInt(event.sequence)

        // If a session is still running or pending, it will pick up new messages
        // via check_new_messages node in the graph - don't dispatch duplicate jobs
        if (lastSession.status === SessionStatuses.PENDING || lastSession.status === SessionStatuses.RUNNING) {
          logger.debug(
            {
              streamId,
              messageId: event.payload.messageId,
              sessionId: lastSession.id,
              sessionStatus: lastSession.status,
            },
            "Session already active for stream, new message will be handled in-flight"
          )
          return []
        }

        // If session completed, check if it already saw this message
        // This prevents re-triggering for messages that an agent decided not to respond to
        if (lastSession.status === SessionStatuses.COMPLETED && lastSession.lastSeenSequence) {
          if (messageSequence <= lastSession.lastSeenSequence) {
            logger.debug(
              {
                streamId,
                messageId: event.payload.messageId,
                messageSequence: messageSequence.toString(),
                lastSeenSequence: lastSession.lastSeenSequence.toString(),
              },
              "Message already seen by previous session, skipping"
            )
            return []
          }
        }
      }

      logger.info(
        { streamId, messageId: event.payload.messageId, personaId: persona.id },
        "Persona agent job will be dispatched (companion mode)"
      )

      // Return job effect - will be executed atomically with cursor update
      return [
        job(JobQueues.PERSONA_AGENT, {
          workspaceId: stream.workspaceId,
          streamId,
          messageId: event.payload.messageId,
          personaId: persona.id,
          triggeredBy,
          // No trigger = companion mode
        }),
      ]
    },
  })
}
