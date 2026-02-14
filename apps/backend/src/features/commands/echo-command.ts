import type { Command, CommandContext, CommandResult } from "./registry"

/**
 * /echo command — simple echo command that demonstrates the slash command pattern.
 *
 * Usage: /echo <text>
 */
export class EchoCommand implements Command {
  name = "echo"
  description = "Echo back the provided text"

  async execute(ctx: CommandContext): Promise<CommandResult> {
    if (!ctx.args.trim()) {
      return {
        success: false,
        error: "Usage: /echo <text>",
      }
    }

    return {
      success: true,
      result: { echoed: ctx.args.trim() },
    }
  }
}
