/**
 * Command infrastructure for slash commands.
 *
 * Commands are registered with the CommandRegistry and executed via the
 * command listener when users send messages starting with /.
 */

import { logger } from "../lib/logger"

export interface CommandContext {
  /** Workspace the command was sent in */
  workspaceId: string
  /** Stream the command was sent in */
  streamId: string
  /** User who sent the command */
  userId: string
  /** Original message ID (for deletion after execution) */
  messageId: string
  /** Arguments after the command name */
  args: string
}

export interface CommandResult {
  /** Whether the command executed successfully */
  success: boolean
  /** Error message if success is false */
  error?: string
}

export interface Command {
  /** Command name without leading slash (e.g., "simulate") */
  name: string
  /** Human-readable description for help text */
  description: string
  /** Execute the command */
  execute(ctx: CommandContext): Promise<CommandResult>
}

/**
 * Registry for slash commands.
 *
 * Commands are registered at startup and looked up when messages
 * starting with / are detected.
 */
export class CommandRegistry {
  private commands = new Map<string, Command>()

  /**
   * Register a command. Throws if a command with the same name exists.
   */
  register(command: Command): void {
    const name = command.name.toLowerCase()

    if (this.commands.has(name)) {
      throw new Error(`Command already registered: ${name}`)
    }

    this.commands.set(name, command)
    logger.info({ command: name }, "Command registered")
  }

  /**
   * Get a command by name (case-insensitive).
   */
  get(name: string): Command | undefined {
    return this.commands.get(name.toLowerCase())
  }

  /**
   * Check if a command exists.
   */
  has(name: string): boolean {
    return this.commands.has(name.toLowerCase())
  }

  /**
   * Get all registered command names.
   */
  getCommandNames(): string[] {
    return Array.from(this.commands.keys())
  }
}

// Re-export parser functions for convenience
export { parseCommand, isCommand } from "./command-parser"
