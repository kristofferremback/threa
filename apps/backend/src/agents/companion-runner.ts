import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"
import { createCompanionGraph, toLangChainMessages } from "./companion-graph"
import type { ProviderRegistry } from "../lib/ai"
import { logger } from "../lib/logger"

/**
 * Parameters for generating a response.
 */
export interface GenerateResponseParams {
  /** Thread ID for checkpointing (typically session.id) */
  threadId: string
  /** Model identifier in provider:model format */
  modelId: string
  /** System prompt for the assistant */
  systemPrompt: string
  /** Conversation history */
  messages: Array<{ role: "user" | "assistant"; content: string }>
}

/**
 * Result from generating a response.
 */
export interface GenerateResponseResult {
  response: string
}

/**
 * Interface for response generators.
 * Allows swapping LangGraph for a stub in tests.
 */
export interface ResponseGenerator {
  run(params: GenerateResponseParams): Promise<GenerateResponseResult>
}

/**
 * LangGraph-based response generator.
 * Uses the companion graph with PostgreSQL checkpointing for durability.
 */
export class LangGraphResponseGenerator implements ResponseGenerator {
  constructor(
    private readonly deps: {
      modelRegistry: ProviderRegistry
      checkpointer: PostgresSaver
    }
  ) {}

  async run(params: GenerateResponseParams): Promise<GenerateResponseResult> {
    const { modelRegistry, checkpointer } = this.deps
    const { threadId, modelId, systemPrompt, messages } = params

    logger.debug(
      {
        threadId,
        modelId,
        messageCount: messages.length,
      },
      "Running companion graph"
    )

    // Get LangChain model from registry
    const model = modelRegistry.getLangChainModel(modelId)

    // Create and compile graph with checkpointer
    const graph = createCompanionGraph(model)
    const compiledGraph = graph.compile({ checkpointer })

    // Convert messages to LangChain format
    const langchainMessages = toLangChainMessages(messages)

    // Invoke the graph
    const result = await compiledGraph.invoke(
      {
        messages: langchainMessages,
        systemPrompt,
        finalResponse: null,
      },
      {
        configurable: { thread_id: threadId },
      }
    )

    const response = result.finalResponse ?? ""

    logger.info(
      {
        threadId,
        responseLength: response.length,
      },
      "Companion graph completed"
    )

    return { response }
  }
}

/**
 * Stub response generator for testing.
 * Returns a canned response without calling any AI.
 */
export class StubResponseGenerator implements ResponseGenerator {
  constructor(
    private readonly response: string = "This is a stub response from the companion. The real AI integration is disabled."
  ) {}

  async run(params: GenerateResponseParams): Promise<GenerateResponseResult> {
    logger.debug({ threadId: params.threadId, messageCount: params.messages.length }, "Running stub response generator")
    return { response: this.response }
  }
}
