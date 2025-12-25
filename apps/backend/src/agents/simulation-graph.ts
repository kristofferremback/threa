import { Annotation, StateGraph, END } from "@langchain/langgraph"
import type { RunnableConfig } from "@langchain/core/runnables"
import { generateObject, generateText } from "ai"
import { z } from "zod"
import type { LanguageModel } from "ai"
import type { Persona } from "../repositories/persona-repository"

/**
 * Tracks a message sent during simulation for context and threading.
 */
export interface SimulationMessage {
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
export const TurnDecisionSchema = z.object({
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

export type TurnDecision = z.infer<typeof TurnDecisionSchema>

/**
 * Callbacks that must be provided when invoking the graph.
 * Passed via configurable in the RunnableConfig.
 */
export interface SimulationGraphCallbacks {
  /** Get the orchestrator model (cheap/fast) */
  getOrchestratorModel: () => LanguageModel
  /** Get a persona's model */
  getPersonaModel: (persona: Persona) => LanguageModel
  /** Create a thread for threading off a message */
  createThread: (params: {
    workspaceId: string
    parentStreamId: string
    parentMessageId: string
    createdBy: string
  }) => Promise<{ id: string }>
  /** Create a message in a stream */
  createMessage: (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: "persona"
    content: string
  }) => Promise<{ id: string }>
}

/**
 * State annotation for the simulation graph.
 */
export const SimulationState = Annotation.Root({
  // Configuration (set at start, immutable)
  streamId: Annotation<string>(),
  workspaceId: Annotation<string>(),
  userId: Annotation<string>(),
  personas: Annotation<Persona[]>(),
  personaMap: Annotation<Record<string, Persona>>(), // slug → Persona for quick lookup
  topic: Annotation<string>(),
  totalTurns: Annotation<number>(),

  // Tracking (updated each turn)
  currentTurn: Annotation<number>({
    default: () => 0,
    reducer: (_, next) => next,
  }),
  history: Annotation<SimulationMessage[]>({
    default: () => [],
    reducer: (prev, next) => [...prev, ...next],
  }),
  // parentMessageId → threadStreamId
  threadCache: Annotation<Record<string, string>>({
    default: () => ({}),
    reducer: (prev, next) => ({ ...prev, ...next }),
  }),
  messagesSent: Annotation<number>({
    default: () => 0,
    reducer: (prev, next) => (next === -1 ? prev : prev + next),
  }),

  // Per-turn state (reset each iteration)
  currentDecision: Annotation<TurnDecision | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),
  currentContent: Annotation<string | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),
  targetStreamId: Annotation<string | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),
  isThreadMessage: Annotation<boolean>({
    default: () => false,
    reducer: (_, next) => next,
  }),
  currentPersona: Annotation<Persona | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),

  // Result
  status: Annotation<"running" | "completed" | "failed">({
    default: () => "running",
    reducer: (_, next) => next,
  }),
  error: Annotation<string | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),
})

export type SimulationStateType = typeof SimulationState.State

/**
 * Get callbacks from the config's configurable field.
 */
function getCallbacks(config: RunnableConfig): SimulationGraphCallbacks {
  const callbacks = config.configurable?.callbacks as SimulationGraphCallbacks | undefined
  if (!callbacks) {
    throw new Error("SimulationGraphCallbacks must be provided in config.configurable.callbacks")
  }
  return callbacks
}

/**
 * Strip markdown code fences from LLM output.
 */
async function stripMarkdownFences({ text }: { text: string }): Promise<string> {
  return text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "")
}

/**
 * Build the orchestrator prompt.
 */
function buildOrchestratorPrompt(state: SimulationStateType): string {
  const personaList = state.personas.map((p) => `- ${p.slug}: ${p.name}`).join("\n")

  let historyText = ""
  if (state.history.length > 0) {
    historyText =
      "\nConversation so far:\n" +
      state.history
        .map((m) => {
          const location = m.isThread ? "(in thread)" : "(in channel)"
          return `Turn ${m.turnNumber}: ${m.personaName} ${location}: "${m.content.slice(0, 150)}${m.content.length > 150 ? "..." : ""}"`
        })
        .join("\n")
  }

  return `You are orchestrating a simulated conversation.

SCENARIO: ${state.topic}

PERSONAS:
${personaList}

CURRENT STATE:
- This is turn ${state.currentTurn} of ${state.totalTurns}
- ${state.history.length === 0 ? "No messages yet - someone needs to start!" : `${state.history.length} messages have been sent`}
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
}

/**
 * Build the persona generation prompt.
 */
function buildPersonaPrompt(state: SimulationStateType, persona: Persona): string {
  let contextText = ""
  if (state.history.length > 0) {
    const recentMessages = state.history.slice(-10)
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

  const locationHint = state.isThreadMessage
    ? "You're replying in a thread - keep it focused and relevant to the parent message."
    : "You're posting in the main channel."

  return `You are ${persona.name}.

SCENARIO: ${state.topic}

${contextText}

${locationHint}

${state.currentTurn === 0 ? "Start the conversation based on the scenario." : "Continue the conversation naturally based on what's been said and the scenario."}

Respond in character. Be natural and engaging. Keep your response concise but meaningful.`
}

/**
 * Orchestrate node: LLM decides who speaks and where.
 */
function createOrchestrateNode() {
  return async (state: SimulationStateType, config: RunnableConfig): Promise<Partial<SimulationStateType>> => {
    const callbacks = getCallbacks(config)
    const model = callbacks.getOrchestratorModel()

    const prompt = buildOrchestratorPrompt(state)

    const result = await generateObject({
      model,
      schema: TurnDecisionSchema,
      prompt,
      temperature: 0.3,
      experimental_repairText: stripMarkdownFences,
    })

    const decision = result.object

    // Validate persona exists
    const persona = state.personaMap[decision.nextSpeaker.toLowerCase()]
    if (!persona) {
      // Fallback to first persona
      const fallbackPersona = state.personas[0]
      return {
        currentDecision: { ...decision, nextSpeaker: fallbackPersona.slug },
        currentPersona: fallbackPersona,
      }
    }

    return {
      currentDecision: decision,
      currentPersona: persona,
    }
  }
}

/**
 * Resolve placement node: Determines target stream (main or thread).
 */
function createResolvePlacementNode() {
  return async (state: SimulationStateType, config: RunnableConfig): Promise<Partial<SimulationStateType>> => {
    const callbacks = getCallbacks(config)
    const decision = state.currentDecision

    if (!decision) {
      return { status: "failed", error: "No decision available" }
    }

    // Default: main channel
    let targetStreamId = state.streamId
    let isThread = false

    if (typeof decision.placement === "object" && "threadOf" in decision.placement) {
      const parentTurn = decision.placement.threadOf
      const parentMessage = state.history.find((m) => m.turnNumber === parentTurn)

      if (parentMessage) {
        // Check if thread already exists
        let threadStreamId = state.threadCache[parentMessage.messageId]

        if (!threadStreamId) {
          // Create new thread
          const thread = await callbacks.createThread({
            workspaceId: state.workspaceId,
            parentStreamId: parentMessage.streamId,
            parentMessageId: parentMessage.messageId,
            createdBy: state.userId,
          })
          threadStreamId = thread.id

          return {
            targetStreamId: threadStreamId,
            isThreadMessage: true,
            threadCache: { [parentMessage.messageId]: threadStreamId },
          }
        }

        targetStreamId = threadStreamId
        isThread = true
      }
    }

    return {
      targetStreamId,
      isThreadMessage: isThread,
    }
  }
}

/**
 * Generate node: Persona LLM generates content.
 */
function createGenerateNode() {
  return async (state: SimulationStateType, config: RunnableConfig): Promise<Partial<SimulationStateType>> => {
    const callbacks = getCallbacks(config)
    const persona = state.currentPersona

    if (!persona) {
      return { status: "failed", error: "No persona selected" }
    }

    const model = callbacks.getPersonaModel(persona)
    const prompt = buildPersonaPrompt(state, persona)

    const result = await generateText({
      model,
      system: persona.systemPrompt ?? undefined,
      prompt,
      temperature: persona.temperature ?? 0.7,
      maxOutputTokens: persona.maxTokens ?? 500,
    })

    const content = result.text?.trim() || null

    if (!content) {
      return { currentContent: null }
    }

    return { currentContent: content }
  }
}

/**
 * Send node: Creates the message.
 */
function createSendNode() {
  return async (state: SimulationStateType, config: RunnableConfig): Promise<Partial<SimulationStateType>> => {
    const callbacks = getCallbacks(config)

    if (!state.currentContent || !state.currentPersona || !state.targetStreamId) {
      // Skip this turn if we couldn't generate content
      return {
        currentTurn: state.currentTurn + 1,
        currentDecision: null,
        currentContent: null,
        currentPersona: null,
        targetStreamId: null,
        isThreadMessage: false,
      }
    }

    const result = await callbacks.createMessage({
      workspaceId: state.workspaceId,
      streamId: state.targetStreamId,
      authorId: state.currentPersona.id,
      authorType: "persona",
      content: state.currentContent,
    })

    const newMessage: SimulationMessage = {
      turnNumber: state.currentTurn,
      personaSlug: state.currentPersona.slug,
      personaName: state.currentPersona.name,
      messageId: result.id,
      streamId: state.targetStreamId,
      content: state.currentContent,
      isThread: state.isThreadMessage,
    }

    return {
      history: [newMessage],
      messagesSent: 1,
      currentTurn: state.currentTurn + 1,
      // Reset per-turn state
      currentDecision: null,
      currentContent: null,
      currentPersona: null,
      targetStreamId: null,
      isThreadMessage: false,
    }
  }
}

/**
 * Route after send: Continue or end.
 */
function routeAfterSend(state: SimulationStateType): "orchestrate" | typeof END {
  if (state.currentTurn >= state.totalTurns) {
    return END
  }
  return "orchestrate"
}

/**
 * Create the simulation graph.
 *
 * Graph structure:
 *   START → orchestrate → resolve_placement → generate → send → (more turns?)
 *                                                                → yes → orchestrate
 *                                                                → no → END
 */
export function createSimulationGraph() {
  const graph = new StateGraph(SimulationState)
    .addNode("orchestrate", createOrchestrateNode())
    .addNode("resolve_placement", createResolvePlacementNode())
    .addNode("generate", createGenerateNode())
    .addNode("send", createSendNode())
    .addEdge("__start__", "orchestrate")
    .addEdge("orchestrate", "resolve_placement")
    .addEdge("resolve_placement", "generate")
    .addEdge("generate", "send")
    .addConditionalEdges("send", routeAfterSend)

  return graph
}
