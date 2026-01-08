import { withClient, type DatabasePools } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import { PersonaRepository } from "../repositories/persona-repository"
import type { OutboxEvent } from "../repositories/outbox-repository"
import { parseMessageCreatedPayload } from "./outbox-payload-parsers"
import { AuthorTypes } from "@threa/types"
import { extractMentionSlugs } from "./mention-extractor"
import { logger } from "./logger"

export interface MentionInvokeListenerDeps {
  pools: DatabasePools
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
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler" | "listenPool" | "queryPool">
): OutboxListener {
  const { pools, jobQueue } = deps

  return new OutboxListener({
    ...config,
    listenPool: pools.listen,
    queryPool: pools.main,
    listenerId: "mention-invoke",
    handler: async (outboxEvent: OutboxEvent) => {
      // Only process message:created events
      if (outboxEvent.eventType !== "message:created") {
        return
      }

      const payload = await parseMessageCreatedPayload(outboxEvent.payload, pools.main)
      if (!payload) {
        logger.debug({ eventId: outboxEvent.id }, "Mention invoke: malformed event, skipping")
        return
      }

      const { streamId, workspaceId, event } = payload

      // Ignore persona messages (avoid infinite loops)
      if (event.actorType !== AuthorTypes.USER) {
        return
      }

      // Guard against missing actorId (should always exist for USER messages)
      if (!event.actorId) {
        logger.warn({ streamId }, "Mention invoke: USER message has no actorId, skipping")
        return
      }

      // Capture actorId after null check for type narrowing in async closure
      const triggeredBy = event.actorId

      // Extract @mentions from message content
      const mentionSlugs = extractMentionSlugs(event.payload.content)
      if (mentionSlugs.length === 0) {
        return
      }

      await withClient(pools.main, async (client) => {
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
            messageId: event.payload.messageId,
            personaId: persona.id,
            triggeredBy,
            trigger: "mention",
          })

          logger.info(
            {
              streamId,
              messageId: event.payload.messageId,
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
