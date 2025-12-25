import type { Pool } from "pg"
import { generateObject, generateText } from "ai"
import { z } from "zod"
import { AuthorTypes, type AuthorType } from "@threa/types"
import { withClient } from "../db"
import { PersonaRepository, type Persona } from "../repositories/persona-repository"
import type { ProviderRegistry } from "../lib/ai/provider-registry"
import type { StreamService } from "../services/stream-service"
import { logger } from "../lib/logger"

export interface SimulationAgentDeps {
  pool: Pool
  providerRegistry: ProviderRegistry
  streamService: StreamService
  createMessage: (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: AuthorType
    content: string
  }) => Promise<{ id: string }>
  /** Model for orchestration decisions (cheap/fast model) */
  orchestratorModel: string
}

export interface SimulationAgentInput {
  streamId: string
  workspaceId: string
  userId: string
  personas: string[]
  topic: string
  turns: number
}

export interface SimulationAgentResult {
  status: "completed" | "failed"
  messagesSent: number
  error?: string
}

/**
 * Tracks a message sent during simulation for context and threading.
 */
interface SimulationMessage {
  turnNumber: number
  personaSlug: string
  personaName: string
  messageId: string
  streamId: string
  content: string
  isThread: boolean
}

/**
 * Decision schema for the orchestrator - who speaks next and where.
 */
const TurnDecisionSchema = z.object({
  nextSpeaker: z.string().describe("Slug of the persona who should speak next"),
  placement: z
    .union([
      z.literal("channel"),
      z.object({
        threadOf: z.number().describe("Turn number to create/reply in a thread of"),
      }),
    ])
    .describe("Where to post: 'channel' for main stream, or { threadOf: N } to thread off turn N"),
  reasoning: z.string().describe("Brief explanation of why this placement makes sense"),
})

type TurnDecision = z.infer<typeof TurnDecisionSchema>

/**
 * Strip markdown code fences from LLM output.
 * Models sometimes wrap JSON in ```json ... ``` even when asked not to.
 */
async function stripMarkdownFences({ text }: { text: string }): Promise<string> {
  return text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "")
}

/**
 * Simulation agent that orchestrates dynamic multi-persona conversations.
 *
 * Unlike simple round-robin, this agent:
 * 1. Uses an orchestrator LLM to decide who speaks and where (channel vs thread)
 * 2. Tracks message IDs to enable threading off previous messages
 * 3. Dynamically creates threads when needed
 * 4. Generates content using each persona's own model/settings
 */
export class SimulationAgent {
  constructor(private readonly deps: SimulationAgentDeps) {}

  async run(input: SimulationAgentInput): Promise<SimulationAgentResult> {
    const { pool, providerRegistry, streamService, createMessage, orchestratorModel } = this.deps
    const { streamId, workspaceId, userId, personas: personaSlugs, topic, turns } = input

    logger.info({ streamId, personaSlugs, topic, turns }, "Starting dynamic simulation")

    // Load personas
    const personas = await withClient(pool, async (client) => {
      const loaded: Persona[] = []
      for (const slug of personaSlugs) {
        const persona = await PersonaRepository.findBySlug(client, slug.toLowerCase(), workspaceId)
        if (persona) {
          loaded.push(persona)
        }
      }
      return loaded
    })

    if (personas.length === 0) {
      return { status: "failed", messagesSent: 0, error: "No valid personas found" }
    }

    const personaMap = new Map(personas.map((p) => [p.slug.toLowerCase(), p]))

    // Track messages for context and threading
    const simulationMessages: SimulationMessage[] = []
    // Map from parent message ID → thread stream ID
    const threadCache = new Map<string, string>()

    let messagesSent = 0

    try {
      for (let turn = 0; turn < turns; turn++) {
        // Phase 1: Orchestrator decides who speaks and where
        const decision = await this.getOrchestratorDecision({
          providerRegistry,
          orchestratorModel,
          personas,
          topic,
          turn,
          totalTurns: turns,
          history: simulationMessages,
        })

        const persona = personaMap.get(decision.nextSpeaker.toLowerCase())
        if (!persona) {
          logger.warn({ turn, decision }, "Orchestrator chose unknown persona, using first available")
          continue
        }

        // Determine target stream (main channel or thread)
        let targetStreamId = streamId
        let isThread = false

        if (typeof decision.placement === "object" && "threadOf" in decision.placement) {
          const parentTurn = decision.placement.threadOf
          const parentMessage = simulationMessages.find((m) => m.turnNumber === parentTurn)

          if (parentMessage) {
            // Check if we already have a thread for this message
            let threadStreamId = threadCache.get(parentMessage.messageId)

            if (!threadStreamId) {
              // Create new thread
              const thread = await streamService.createThread({
                workspaceId,
                parentStreamId: parentMessage.streamId,
                parentMessageId: parentMessage.messageId,
                createdBy: userId,
              })
              threadStreamId = thread.id
              threadCache.set(parentMessage.messageId, threadStreamId)
              logger.debug({ threadId: threadStreamId, parentTurn }, "Created thread for simulation")
            }

            targetStreamId = threadStreamId
            isThread = true
          } else {
            logger.warn({ turn, parentTurn }, "Cannot thread off non-existent turn, posting to channel")
          }
        }

        // Phase 2: Generate content using persona's model
        const content = await this.generatePersonaContent({
          providerRegistry,
          persona,
          topic,
          turn,
          history: simulationMessages,
          isThread,
        })

        if (!content) {
          logger.warn({ turn, persona: persona.slug }, "Empty response from persona, skipping")
          continue
        }

        // Send the message
        const result = await createMessage({
          workspaceId,
          streamId: targetStreamId,
          authorId: persona.id,
          authorType: AuthorTypes.PERSONA,
          content,
        })

        // Track for future turns
        simulationMessages.push({
          turnNumber: turn,
          personaSlug: persona.slug,
          personaName: persona.name,
          messageId: result.id,
          streamId: targetStreamId,
          content,
          isThread,
        })

        messagesSent++
        logger.debug(
          {
            turn,
            persona: persona.slug,
            placement: decision.placement,
            content: content.slice(0, 100),
          },
          "Simulation message sent"
        )
      }

      logger.info({ streamId, messagesSent }, "Simulation completed")
      return { status: "completed", messagesSent }
    } catch (err) {
      logger.error({ err, streamId, messagesSent }, "Simulation failed")
      return { status: "failed", messagesSent, error: String(err) }
    }
  }

  /**
   * Ask the orchestrator LLM to decide who speaks next and where.
   */
  private async getOrchestratorDecision(params: {
    providerRegistry: ProviderRegistry
    orchestratorModel: string
    personas: Persona[]
    topic: string
    turn: number
    totalTurns: number
    history: SimulationMessage[]
  }): Promise<TurnDecision> {
    const { providerRegistry, orchestratorModel, personas, topic, turn, totalTurns, history } = params

    const model = providerRegistry.getModel(orchestratorModel)
    const personaList = personas.map((p) => `- ${p.slug}: ${p.name}`).join("\n")

    let historyText = ""
    if (history.length > 0) {
      historyText =
        "\nConversation so far:\n" +
        history
          .map((m) => {
            const location = m.isThread ? "(in thread)" : "(in channel)"
            return `Turn ${m.turnNumber}: ${m.personaName} ${location}: "${m.content.slice(0, 150)}${m.content.length > 150 ? "..." : ""}"`
          })
          .join("\n")
    }

    const prompt = `You are orchestrating a simulated conversation.

SCENARIO: ${topic}

PERSONAS:
${personaList}

CURRENT STATE:
- This is turn ${turn} of ${totalTurns}
- ${history.length === 0 ? "No messages yet - someone needs to start!" : `${history.length} messages have been sent`}
${historyText}

Decide who speaks next and where they should post their message.

REQUIRED OUTPUT FORMAT (use these exact field names):
{"nextSpeaker": "<persona_slug>", "placement": "channel", "reasoning": "<why>"}
or for threading:
{"nextSpeaker": "<persona_slug>", "placement": {"threadOf": <turn_number>}, "reasoning": "<why>"}

PLACEMENT OPTIONS:
- "channel": Post in the main conversation
- {"threadOf": N}: Create/reply in a thread attached to turn N's message

Consider the scenario description - if it mentions threading or replying to specific messages, honor that.
If the scenario describes a flow (e.g., "A asks, B responds, A replies in thread"), follow it.
Otherwise, use your judgment to create natural conversation flow.

Output JSON only. Use "nextSpeaker" not "speaker".`

    const result = await generateObject({
      model,
      schema: TurnDecisionSchema,
      prompt,
      temperature: 0.3,
      experimental_repairText: stripMarkdownFences,
    })

    logger.debug({ turn, decision: result.object }, "Orchestrator decision")
    return result.object
  }

  /**
   * Generate the actual message content using the persona's model and settings.
   */
  private async generatePersonaContent(params: {
    providerRegistry: ProviderRegistry
    persona: Persona
    topic: string
    turn: number
    history: SimulationMessage[]
    isThread: boolean
  }): Promise<string | null> {
    const { providerRegistry, persona, topic, turn, history, isThread } = params

    const model = providerRegistry.getModel(persona.model)

    let contextText = ""
    if (history.length > 0) {
      // Show recent messages for context
      const recentMessages = history.slice(-10)
      contextText =
        "\nRecent conversation:\n" +
        recentMessages
          .map((m) => {
            const speaker = m.personaSlug === persona.slug ? "You" : m.personaName
            const location = m.isThread ? " (in thread)" : ""
            return `${speaker}${location}: ${m.content}`
          })
          .join("\n")
    }

    const locationHint = isThread
      ? "You're replying in a thread - keep it focused and relevant to the parent message."
      : "You're posting in the main channel."

    const prompt = `You are ${persona.name}.

SCENARIO: ${topic}

${contextText}

${locationHint}

${turn === 0 ? "Start the conversation based on the scenario." : "Continue the conversation naturally based on what's been said and the scenario."}

Respond in character. Be natural and engaging. Keep your response concise but meaningful.`

    const result = await generateText({
      model,
      system: persona.systemPrompt ?? undefined,
      prompt,
      temperature: persona.temperature ?? 0.7,
      maxOutputTokens: persona.maxTokens ?? 500,
    })

    return result.text?.trim() || null
  }
}
