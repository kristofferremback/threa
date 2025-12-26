import { z } from "zod"
import type { Request, Response } from "express"
import type { Pool } from "pg"
import { withTransaction } from "../db"
import { CommandRegistry, parseCommand } from "../commands"
import type { StreamService } from "../services/stream-service"
import { StreamEventRepository } from "../repositories/stream-event-repository"
import { OutboxRepository } from "../repositories/outbox-repository"
import { eventId, commandId as generateCommandId } from "../lib/id"
import { serializeBigInt } from "../lib/serialization"

const dispatchCommandSchema = z.object({
  command: z.string().min(1, "command is required"),
  streamId: z.string().min(1, "streamId is required"),
})

export interface CommandDispatchedPayload {
  commandId: string
  name: string
  args: string
  status: "dispatched"
}

interface Dependencies {
  pool: Pool
  commandRegistry: CommandRegistry
  streamService: StreamService
}

export function createCommandHandlers({ pool, commandRegistry, streamService }: Dependencies) {
  return {
    /**
     * Dispatch a slash command.
     *
     * This validates the command, creates a command_dispatched event,
     * queues the command for execution, and returns an ack.
     */
    async dispatch(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!

      const result = dispatchCommandSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { command: commandString, streamId } = result.data

      // Validate stream access
      const [stream, isStreamMember] = await Promise.all([
        streamService.getStreamById(streamId),
        streamService.isMember(streamId, userId),
      ])

      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({
          success: false,
          error: "Stream not found",
        })
      }

      if (!isStreamMember) {
        return res.status(403).json({
          success: false,
          error: "Not a member of this stream",
        })
      }

      // Parse the command
      const parsed = parseCommand(commandString)
      if (!parsed) {
        return res.status(400).json({
          success: false,
          error: "Invalid command format. Commands must start with / followed by a name.",
        })
      }

      // Look up the command
      const cmd = commandRegistry.get(parsed.name)
      if (!cmd) {
        return res.status(404).json({
          success: false,
          error: `Unknown command: ${parsed.name}`,
          availableCommands: commandRegistry.getCommandNames(),
        })
      }

      // Create command_dispatched event
      const cmdId = generateCommandId()
      const evtId = eventId()

      // Create event and publish to outbox in a single transaction.
      // The command listener will pick up the outbox event and dispatch the job,
      // ensuring durability (job is only dispatched after event is committed).
      const event = await withTransaction(pool, async (client) => {
        const evt = await StreamEventRepository.insert(client, {
          id: evtId,
          streamId,
          eventType: "command_dispatched",
          payload: {
            commandId: cmdId,
            name: parsed.name,
            args: parsed.args,
            status: "dispatched",
          } satisfies CommandDispatchedPayload,
          actorId: userId,
          actorType: "user",
        })

        // Publish to outbox for:
        // 1. Author-only broadcast (real-time)
        // 2. Command listener to dispatch job (durability)
        await OutboxRepository.insert(client, "command:dispatched", {
          workspaceId,
          streamId,
          event: serializeBigInt(evt),
          authorId: userId,
        })

        return evt
      })

      // Return ack with command details
      res.status(202).json({
        success: true,
        commandId: cmdId,
        command: parsed.name,
        args: parsed.args,
        event: serializeBigInt(event),
      })
    },

    /**
     * List available commands with their metadata.
     */
    list(_req: Request, res: Response) {
      const commands = commandRegistry.getCommandNames().map((name) => {
        const cmd = commandRegistry.get(name)!
        return { name, description: cmd.description }
      })
      res.json({ commands })
    },
  }
}
