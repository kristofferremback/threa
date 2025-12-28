import type { Pool } from "pg"
import { withClient } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { JobQueueManager, JobQueues } from "./job-queue"
import { StreamRepository } from "../repositories/stream-repository"
import { PersonaRepository } from "../repositories/persona-repository"
import type { OutboxEvent, MessageCreatedOutboxPayload } from "../repositories/outbox-repository"
import { AuthorTypes, StreamTypes } from "@threa/types"
import { extractMentionSlugs } from "./mention-extractor"
import { StreamService } from "../services/stream-service"
import { logger } from "./logger"

interface MessageCreatedEventPayload {
  messageId: string
  content: string
  contentFormat: string
}

export interface MentionInvokeListenerDeps {
  pool: Pool
  jobQueue: JobQueueManager
  streamService: StreamService
}

/**
 * Creates a listener that invokes personas when @mentioned in messages.
 *
 * Behavior by stream type:
 * - Channel: Create a thread on the message, persona responds there
 * - Thread: Persona responds directly in the thread
 * - Scratchpad: Persona responds directly in the scratchpad
 * - DM: Persona responds directly in the DM
 */
export function createMentionInvokeListener(
  deps: MentionInvokeListenerDeps,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler">
): OutboxListener {
  const { pool, jobQueue, streamService } = deps

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

      // Extract @mentions from message content
      const mentionSlugs = extractMentionSlugs(eventPayload.content)
      if (mentionSlugs.length === 0) {
        return
      }

      await withClient(pool, async (client) => {
        // Get the stream to determine type and response behavior
        const stream = await StreamRepository.findById(client, streamId)
        if (!stream) {
          logger.warn({ streamId }, "Mention invoke listener: stream not found")
          return
        }

        // Look up each mention to find persona matches
        for (const slug of mentionSlugs) {
          const persona = await PersonaRepository.findBySlug(client, slug, workspaceId)

          // Skip if not a persona (could be a user mention) or if inactive
          if (!persona || persona.status !== "active") {
            continue
          }

          // Determine where the persona should respond
          let targetStreamId = streamId

          if (stream.type === StreamTypes.CHANNEL) {
            // For channels, create a thread on the message and respond there
            const thread = await streamService.createThread({
              workspaceId,
              parentStreamId: streamId,
              parentMessageId: eventPayload.messageId,
              createdBy: event.actorId!,
            })
            targetStreamId = thread.id
          }
          // For thread/scratchpad/dm, respond directly in the same stream

          // Dispatch job to invoke the persona
          await jobQueue.send(JobQueues.PERSONA_INVOKE, {
            workspaceId,
            streamId,
            messageId: eventPayload.messageId,
            personaId: persona.id,
            triggeredBy: event.actorId!,
            targetStreamId,
          })

          logger.info(
            {
              streamId,
              targetStreamId,
              messageId: eventPayload.messageId,
              personaId: persona.id,
              personaSlug: persona.slug,
            },
            "Persona invoke job dispatched"
          )
        }
      })
    },
  })
}
