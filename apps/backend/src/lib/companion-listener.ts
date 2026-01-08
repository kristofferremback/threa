import { withClient, type DatabasePools } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import { StreamRepository } from "../repositories/stream-repository"
import { PersonaRepository } from "../repositories/persona-repository"
import { AgentSessionRepository, SessionStatuses } from "../repositories/agent-session-repository"
import type { OutboxEvent } from "../repositories/outbox-repository"
import { parseMessageCreatedPayload } from "./outbox-payload-parsers"
import { AuthorTypes, CompanionModes } from "@threa/types"
import { logger } from "./logger"

/**
 * Creates a companion listener that dispatches agentic jobs for messages
 * in streams with companion mode enabled.
 *
 * Flow:
 * 1. Message arrives (via outbox)
 * 2. Check if it's a user message (not persona response)
 * 3. Check if stream has companion mode = 'on'
 * 4. Dispatch durable job to pg-boss for agent processing
 */
export function createCompanionListener(
  pools: DatabasePools,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler" | "listenPool" | "queryPool">
): OutboxListener {
  return new OutboxListener({
    ...config,
    listenPool: pools.listen,
    queryPool: pools.main,
    listenerId: "companion",
    handler: async (outboxEvent: OutboxEvent) => {
      // Only process message:created events
      if (outboxEvent.eventType !== "message:created") {
        return
      }

      const payload = await parseMessageCreatedPayload(outboxEvent.payload, pools.main)
      if (!payload) {
        logger.debug({ eventId: outboxEvent.id }, "Companion listener: malformed event, skipping")
        return
      }

      const { streamId, event } = payload

      // Ignore persona messages (avoid infinite loops)
      if (event.actorType !== AuthorTypes.USER) {
        return
      }

      // Guard against missing actorId (should always exist for USER messages)
      if (!event.actorId) {
        logger.warn({ streamId }, "Companion listener: USER message has no actorId, skipping")
        return
      }

      // Capture actorId after null check for type narrowing in async closure
      const triggeredBy = event.actorId

      // Look up stream to check companion mode
      await withClient(pools.main, async (client) => {
        const stream = await StreamRepository.findById(client, streamId)
        if (!stream) {
          logger.warn({ streamId }, "Companion listener: stream not found")
          return
        }

        if (stream.companionMode !== CompanionModes.ON) {
          return
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
          return
        }

        // Check if this message was already seen by a previous session
        // This prevents re-triggering for messages that an agent decided not to respond to
        const lastSession = await AgentSessionRepository.findLatestByStream(client, streamId)
        if (lastSession?.status === SessionStatuses.COMPLETED && lastSession.lastSeenSequence) {
          const messageSequence = BigInt(event.sequence)
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
            return
          }
        }

        // Dispatch job to pg-boss for durable processing
        await jobQueue.send(JobQueues.PERSONA_AGENT, {
          workspaceId: stream.workspaceId,
          streamId,
          messageId: event.payload.messageId,
          personaId: persona.id,
          triggeredBy,
          // No trigger = companion mode
        })

        logger.info(
          { streamId, messageId: event.payload.messageId, personaId: persona.id },
          "Persona agent job dispatched (companion mode)"
        )
      })
    },
  })
}
