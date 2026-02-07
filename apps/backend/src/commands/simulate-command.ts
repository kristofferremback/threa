import { z } from "zod"
import type { Pool } from "pg"
import type { Command, CommandContext, CommandResult } from "./index"
import type { AI } from "../lib/ai/ai"
import type { SimulationAgentLike } from "../workers/simulation-worker"
import { PersonaRepository } from "../repositories/persona-repository"
import { withClient } from "../db"
import { logger } from "../lib/logger"

// Schema for LLM parsing - all fields required for OpenAI strict mode compatibility
const SimulationParamsSchema = z.object({
  personas: z.array(z.string()).min(1).max(5).describe("List of persona names/slugs mentioned in the command"),
  topic: z.string().describe("The topic or theme of the conversation, inferred from context"),
  turns: z
    .number()
    .int()
    .min(1)
    .max(50)
    .describe("Number of conversation turns (each turn = one message from one persona)"),
  thread: z.boolean().describe("Whether to run the simulation in a thread"),
})

type SimulationParams = z.infer<typeof SimulationParamsSchema>

/**
 * Build the parsing prompt with available personas as context.
 */
function buildParsingPrompt(availablePersonas: string[]): string {
  const personaList = availablePersonas.length > 0 ? availablePersonas.join(", ") : "(none available)"

  return `Parse the command and extract: personas (array), topic (string), turns (number, default 5), thread (boolean, default false).

AVAILABLE PERSONAS: ${personaList}
Match persona names from the command to the available personas above. Use exact slugs from the list.

IMPORTANT: Personas are simple identifiers (one or two words like "ariadne", "bob", "the_critic").
Role descriptions like "as a reporter" or "pretending to be X" are part of the TOPIC, not the persona name.

THREAD: Set thread=true if the user says "in a thread", "as a thread", or similar.

Output raw JSON only. No markdown, no code blocks, no explanation.

Examples:
Input: "ariadne and bob discussing API design for 10 turns"
Output: {"personas":["ariadne","bob"],"topic":"API design","turns":10,"thread":false}

Input: "just ariadne thinking out loud, 3 turns"
Output: {"personas":["ariadne"],"topic":"thinking out loud","turns":3,"thread":false}

Input: "ariadne should interview herself as if she's a reporter, 4 turns"
Output: {"personas":["ariadne"],"topic":"interview herself as if she's a reporter","turns":4,"thread":false}

Input: "bob and alice discuss the weather in a thread"
Output: {"personas":["bob","alice"],"topic":"the weather","turns":5,"thread":true}

Input: "ariadne explores ideas, 6 turns, in a thread"
Output: {"personas":["ariadne"],"topic":"explores ideas","turns":6,"thread":true}

Input:`
}

interface SimulateCommandDeps {
  pool: Pool
  ai: AI
  simulationAgent: SimulationAgentLike
  parsingModel: string
}

/**
 * /simulate command - starts a simulated conversation between personas.
 *
 * Usage: /simulate ariadne and bob discussing API design for 10 turns
 */
export class SimulateCommand implements Command {
  name = "simulate"
  description = "Simulate a conversation between AI personas"

  constructor(private deps: SimulateCommandDeps) {}

  async execute(ctx: CommandContext): Promise<CommandResult> {
    const { args, streamId, workspaceId, memberId, commandId } = ctx

    if (!args.trim()) {
      return {
        success: false,
        error: "Usage: /simulate <personas> discussing <topic> [for N turns]",
      }
    }

    // Get available personas for context
    const availablePersonas = await this.getAvailablePersonaSlugs(workspaceId)

    // Parse natural language args
    let params: SimulationParams
    try {
      params = await this.parseArgs(args, availablePersonas)
    } catch (err) {
      logger.warn({ err, args }, "Failed to parse simulation args")
      return {
        success: false,
        error: `Could not understand command. Try: /simulate ariadne and bob discussing API design for 10 turns`,
      }
    }

    // Validate personas exist
    const validation = await this.validatePersonas(params.personas, workspaceId)
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error!,
      }
    }

    // Threading from commands not yet supported
    if (params.thread) {
      return {
        success: false,
        error: "Threading is not yet supported for /simulate. Run without 'in a thread'.",
      }
    }

    logger.info(
      {
        commandId,
        streamId,
        personas: params.personas,
        topic: params.topic,
        turns: params.turns,
      },
      "Running simulation"
    )

    // Run simulation directly (we're already in a background job)
    const result = await this.deps.simulationAgent.run({
      streamId,
      workspaceId,
      memberId,
      personas: params.personas,
      topic: params.topic,
      turns: params.turns,
    })

    if (result.status === "failed") {
      return {
        success: false,
        error: result.error || "Simulation failed",
      }
    }

    return {
      success: true,
      result: {
        personas: params.personas,
        topic: params.topic,
        turns: params.turns,
        messagesSent: result.messagesSent,
      },
    }
  }

  private async parseArgs(args: string, availablePersonas: string[]): Promise<SimulationParams> {
    const prompt = buildParsingPrompt(availablePersonas)

    const { value } = await this.deps.ai.generateObject({
      model: this.deps.parsingModel,
      schema: SimulationParamsSchema,
      messages: [{ role: "user", content: `${prompt} ${args}` }],
      temperature: 0,
      telemetry: {
        functionId: "simulate-parse-args",
      },
    })

    return value
  }

  private async getAvailablePersonaSlugs(workspaceId: string): Promise<string[]> {
    const personas = await PersonaRepository.listForWorkspace(this.deps.pool, workspaceId)
    return personas.map((p) => p.slug)
  }

  private async validatePersonas(slugs: string[], workspaceId: string): Promise<{ valid: boolean; error?: string }> {
    const missing: string[] = []

    await withClient(this.deps.pool, async (client) => {
      for (const slug of slugs) {
        const persona = await PersonaRepository.findBySlug(client, slug.toLowerCase(), workspaceId)
        if (!persona) {
          missing.push(slug)
        }
      }
    })

    if (missing.length > 0) {
      return {
        valid: false,
        error: `Unknown persona${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
      }
    }

    return { valid: true }
  }
}
