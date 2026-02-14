/**
 * Commands feature - slash command infrastructure.
 *
 * Exports:
 * - HTTP handlers for command dispatch
 * - Command registry and base types
 * - Outbox handler for command job dispatching
 * - Worker for command execution
 * - Built-in commands (echo)
 */

// HTTP handlers
export { createCommandHandlers } from "./handlers"
export type { CommandDispatchedPayload } from "./handlers"

// Command registry and types
export { CommandRegistry, parseCommand, isCommand } from "./registry"
export type { Command, CommandContext, CommandResult } from "./registry"

// Outbox handler
export { CommandHandler } from "./outbox-handler"
export type { CommandHandlerConfig } from "./outbox-handler"

// Worker
export { createCommandWorker } from "./worker"
export type { CommandWorkerDeps, CommandCompletedPayload, CommandFailedPayload } from "./worker"

// Built-in commands
export { EchoCommand } from "./echo-command"
