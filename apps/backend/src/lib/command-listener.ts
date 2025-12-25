import type { Pool } from "pg"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { CommandRegistry, parseCommand } from "../commands"
import type { OutboxEvent, MessageCreatedOutboxPayload } from "../repositories/outbox-repository"
import type { EventService } from "../services/event-service"
import { AuthorTypes } from "@threa/types"
import { logger } from "./logger"

interface MessageCreatedEventPayload {
  messageId: string
  content: string
  contentFormat: string
}

interface CommandListenerDeps {
  pool: Pool
  commandRegistry: CommandRegistry
  eventService: EventService
}

/**
 * Creates a command listener that detects and executes slash commands.
 *
 * Flow:
 * 1. Message arrives (via outbox)
 * 2. Check if it's a user message starting with /
 * 3. Parse command name and args
 * 4. Execute via command registry
 * 5. Delete command message on success (keeps chat clean)
 */
export function createCommandListener(
  deps: CommandListenerDeps,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler">
): OutboxListener {
  const { pool, commandRegistry, eventService } = deps

  return new OutboxListener(pool, {
    ...config,
    listenerId: "commands",
    handler: async (outboxEvent: OutboxEvent) => {
      // Only process message:created events
      if (outboxEvent.eventType !== "message:created") {
        return
      }

      const payload = outboxEvent.payload as MessageCreatedOutboxPayload
      const { event, streamId, workspaceId } = payload
      const eventPayload = event.payload as MessageCreatedEventPayload

      // Ignore persona messages
      if (event.actorType !== AuthorTypes.USER) {
        return
      }

      // Check if message is a command
      const parsed = parseCommand(eventPayload.content)
      if (!parsed) {
        return
      }

      // Look up the command
      const command = commandRegistry.get(parsed.name)
      if (!command) {
        logger.debug({ command: parsed.name }, "Unknown command, ignoring")
        return
      }

      logger.info({ command: parsed.name, streamId, messageId: eventPayload.messageId }, "Executing command")

      // Execute the command
      const result = await command.execute({
        workspaceId,
        streamId,
        userId: event.actorId!,
        messageId: eventPayload.messageId,
        args: parsed.args,
      })

      if (result.success) {
        // Delete the command message to keep chat clean
        await eventService.deleteMessage({
          workspaceId,
          streamId,
          messageId: eventPayload.messageId,
          actorId: event.actorId!,
        })

        logger.info(
          { command: parsed.name, streamId, messageId: eventPayload.messageId },
          "Command executed and message deleted"
        )
      } else {
        // Leave the message visible for debugging
        logger.warn(
          { command: parsed.name, error: result.error, streamId, messageId: eventPayload.messageId },
          "Command execution failed"
        )
      }
    },
  })
}
