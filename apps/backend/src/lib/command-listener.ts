import type { Pool } from "pg"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { CommandRegistry, parseCommand } from "../commands"
import type { OutboxEvent, MessageCreatedOutboxPayload } from "../repositories/outbox-repository"
import type { EventService } from "../services/event-service"
import { AuthorTypes } from "@threa/types"
import { commandId as generateCommandId } from "./id"
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

      // Guard against malformed events (e.g., old events before migration)
      if (!payload.event?.payload) {
        return
      }

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

      // This is a backwards-compatibility fallback. New commands should go through
      // the /commands/dispatch endpoint which avoids the message flash.
      logger.warn(
        { command: parsed.name, streamId, messageId: eventPayload.messageId },
        "[DEPRECATED] Command detected via message. Use /commands/dispatch endpoint instead."
      )

      const commandId = generateCommandId()

      // Execute the command
      const result = await command.execute({
        commandId,
        commandName: parsed.name,
        workspaceId,
        streamId,
        userId: event.actorId!,
        args: parsed.args,
      })

      // Always delete the command message to minimize flash visibility
      await eventService.deleteMessage({
        workspaceId,
        streamId,
        messageId: eventPayload.messageId,
        actorId: event.actorId!,
      })

      if (result.success) {
        logger.info(
          { command: parsed.name, commandId, streamId, messageId: eventPayload.messageId },
          "Command executed via fallback listener"
        )
      } else {
        logger.warn(
          { command: parsed.name, commandId, error: result.error, streamId, messageId: eventPayload.messageId },
          "Command execution failed via fallback listener"
        )
      }
    },
  })
}
