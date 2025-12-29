import type { Pool } from "pg"
import { withClient } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import { PersonaRepository } from "../repositories/persona-repository"
import type { OutboxEvent, MessageCreatedOutboxPayload } from "../repositories/outbox-repository"
import { AuthorTypes } from "@threa/types"
import { extractMentionSlugs } from "./mention-extractor"
import { logger } from "./logger"

interface MessageCreatedEventPayload {
  messageId: string
  content: string
  contentFormat: string
}

export interface MentionInvokeListenerDeps {
  pool: Pool
  jobQueue: JobQueueManager
}

/**
 * Creates a listener that invokes personas when @mentioned in messages.
 *
 * Behavior by stream type:
 * - Channel: Agent creates a thread on the message, persona responds there
 * - Thread: Persona responds directly in the thread
 * - Scratchpad: Persona responds directly in the scratchpad
 * - DM: Persona responds directly in the DM
 *
 * Note: Thread creation for channels is handled by the PersonaAgent, not this listener.
 */
export function createMentionInvokeListener(
  deps: MentionInvokeListenerDeps,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler">
): OutboxListener {
  const { pool, jobQueue } = deps

  return new OutboxListener(pool, {
    ...config,
    listenerId: "mention-invoke",
    handler: async (outboxEvent: OutboxEvent) => {
      // Only process message:created events
      if (outboxEvent.eventType !== "message:created") {
        return
      }

      const payload = outboxEvent.payload as MessageCreatedOutboxPayload
      const { event, streamId, workspaceId } = payload
      const eventPayload = event.payload as MessageCreatedEventPayload

      // Ignore persona messages (avoid infinite loops)
      if (event.actorType !== AuthorTypes.USER) {
        return
      }

      // Guard against missing actorId (should always exist for USER messages)
      if (!event.actorId) {
        logger.warn({ streamId }, "Mention invoke: USER message has no actorId, skipping")
        return
      }

      // Extract @mentions from message content
      const mentionSlugs = extractMentionSlugs(eventPayload.content)
      if (mentionSlugs.length === 0) {
        return
      }

      await withClient(pool, async (client) => {
        // Look up each mention to find persona matches
        for (const slug of mentionSlugs) {
          const persona = await PersonaRepository.findBySlug(client, slug, workspaceId)

          // Skip if not a persona (could be a user mention) or if inactive
          if (!persona || persona.status !== "active") {
            continue
          }

          // Dispatch job to invoke the persona
          // Note: Agent handles thread creation for channels
          await jobQueue.send(JobQueues.PERSONA_AGENT, {
            workspaceId,
            streamId,
            messageId: eventPayload.messageId,
            personaId: persona.id,
            triggeredBy: event.actorId,
            trigger: "mention",
          })

          logger.info(
            {
              streamId,
              messageId: eventPayload.messageId,
              personaId: persona.id,
              personaSlug: persona.slug,
            },
            "Persona agent job dispatched (mention trigger)"
          )
        }
      })
    },
  })
}
