import type { Pool } from "pg"
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"
import { AuthorTypes, type AuthorType } from "@threa/types"
import { withClient } from "../db"
import { PersonaRepository, type Persona } from "../repositories/persona-repository"
import type { ProviderRegistry } from "../lib/ai/provider-registry"
import type { StreamService } from "../services/stream-service"
import { logger } from "../lib/logger"
import { createSimulationGraph, type SimulationGraphCallbacks, type SimulationStateType } from "./simulation-graph"
import { CallbackHandler } from "@langfuse/langchain"
import { isLangfuseEnabled } from "../lib/langfuse"

export interface SimulationAgentDeps {
  pool: Pool
  providerRegistry: ProviderRegistry
  streamService: StreamService
  checkpointer: PostgresSaver
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
 * Simulation agent that orchestrates dynamic multi-persona conversations
 * using LangGraph for consistency with the companion agent pattern.
 *
 * The graph structure:
 *   START → orchestrate → resolve_placement → generate → send → (more turns?)
 *                                                                → yes → orchestrate
 *                                                                → no → END
 *
 * Key features:
 * 1. Orchestrator LLM decides who speaks and where (channel vs thread)
 * 2. Tracks message IDs to enable threading off previous messages
 * 3. Dynamically creates threads when needed
 * 4. Generates content using each persona's own model/settings
 */
export class SimulationAgent {
  constructor(private readonly deps: SimulationAgentDeps) {}

  async run(input: SimulationAgentInput): Promise<SimulationAgentResult> {
    const { pool, providerRegistry, streamService, checkpointer, createMessage, orchestratorModel } = this.deps
    const { streamId, workspaceId, userId, personas: personaSlugs, topic, turns } = input

    logger.info({ streamId, personaSlugs, topic, turns }, "Starting simulation via LangGraph")

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

    // Build persona map for quick lookup
    const personaMap: Record<string, Persona> = {}
    for (const p of personas) {
      personaMap[p.slug.toLowerCase()] = p
    }

    // Create callbacks for the graph
    const callbacks: SimulationGraphCallbacks = {
      getOrchestratorModel: () => providerRegistry.getModel(orchestratorModel),
      getPersonaModel: (persona) => providerRegistry.getModel(persona.model),
      createThread: async (params) => {
        const thread = await streamService.createThread(params)
        logger.debug({ threadId: thread.id, parentMessageId: params.parentMessageId }, "Created thread for simulation")
        return thread
      },
      createMessage: async (params) => {
        const result = await createMessage({
          workspaceId: params.workspaceId,
          streamId: params.streamId,
          authorId: params.authorId,
          authorType: AuthorTypes.PERSONA,
          content: params.content,
        })
        return result
      },
    }

    // Create and compile graph
    const graph = createSimulationGraph()
    const compiledGraph = graph.compile({ checkpointer })

    // Initial state
    const initialState: Partial<SimulationStateType> = {
      streamId,
      workspaceId,
      userId,
      personas,
      personaMap,
      topic,
      totalTurns: turns,
      currentTurn: 0,
      history: [],
      threadCache: {},
      messagesSent: 0,
      status: "running",
    }

    // Thread ID for checkpointing (unique per simulation run)
    const threadId = `simulation_${streamId}_${Date.now()}`

    // Create Langfuse callback for tracing (if enabled)
    const langchainCallbacks = isLangfuseEnabled()
      ? [new CallbackHandler({ sessionId: threadId, tags: ["simulation"] })]
      : []

    try {
      const result = await compiledGraph.invoke(initialState, {
        callbacks: langchainCallbacks,
        configurable: {
          thread_id: threadId,
          callbacks,
        },
      })

      const finalState = result as SimulationStateType

      if (finalState.status === "failed") {
        logger.error({ streamId, error: finalState.error }, "Simulation failed")
        return { status: "failed", messagesSent: finalState.messagesSent, error: finalState.error ?? "Unknown error" }
      }

      logger.info({ streamId, messagesSent: finalState.messagesSent }, "Simulation completed")
      return { status: "completed", messagesSent: finalState.messagesSent }
    } catch (err) {
      logger.error({ err, streamId }, "Simulation graph execution failed")
      return { status: "failed", messagesSent: 0, error: String(err) }
    }
  }
}
