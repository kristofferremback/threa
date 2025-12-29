import type { Pool } from "pg"
import { withClient } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import { StreamRepository } from "../repositories/stream-repository"
import { PersonaRepository } from "../repositories/persona-repository"
import { AgentSessionRepository, SessionStatuses } from "../repositories/agent-session-repository"
import type { OutboxEvent, MessageCreatedOutboxPayload } from "../repositories/outbox-repository"
import { AuthorTypes, CompanionModes } from "@threa/types"
import { logger } from "./logger"

interface MessageCreatedEventPayload {
  messageId: string
  content: string
  contentFormat: string
}

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
  pool: Pool,
  jobQueue: JobQueueManager,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler">
): OutboxListener {
  return new OutboxListener(pool, {
    ...config,
    listenerId: "companion",
    handler: async (outboxEvent: OutboxEvent) => {
      // Only process message:created events
      if (outboxEvent.eventType !== "message:created") {
        return
      }

      const payload = outboxEvent.payload as MessageCreatedOutboxPayload
      const { event, streamId } = payload
      const eventPayload = event.payload as MessageCreatedEventPayload

      // Ignore persona messages (avoid infinite loops)
      if (event.actorType !== AuthorTypes.USER) {
        return
      }

      // Look up stream to check companion mode
      await withClient(pool, async (client) => {
        const stream = await StreamRepository.findById(client, streamId)
        if (!stream) {
          logger.warn({ streamId }, "Companion listener: stream not found")
          return
        }

        if (stream.companionMode !== CompanionModes.ON) {
          return
        }

        if (!stream.companionPersonaId) {
          logger.warn({ streamId }, "Companion mode on but no persona configured")
          return
        }

        // Resolve persona and validate it's active
        const persona = await PersonaRepository.findById(client, stream.companionPersonaId)
        if (!persona || persona.status !== "active") {
          logger.warn({ streamId, personaId: stream.companionPersonaId }, "Companion persona not found or inactive")
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
                messageId: eventPayload.messageId,
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
          messageId: eventPayload.messageId,
          personaId: persona.id,
          triggeredBy: event.actorId!,
          // No trigger = companion mode
        })

        logger.info(
          { streamId, messageId: eventPayload.messageId, personaId: persona.id },
          "Persona agent job dispatched (companion mode)"
        )
      })
    },
  })
}
