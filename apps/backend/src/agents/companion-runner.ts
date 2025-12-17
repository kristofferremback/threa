import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"
import { createCompanionGraph, toLangChainMessages } from "./companion-graph"
import type { ProviderRegistry } from "../lib/ai"
import { logger } from "../lib/logger"

/**
 * Dependencies required by the companion runner.
 */
export interface CompanionRunnerDeps {
  modelRegistry: ProviderRegistry
  checkpointer: PostgresSaver
}

/**
 * Parameters for running the companion graph.
 */
export interface RunCompanionParams {
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
 * Result from running the companion graph.
 */
export interface CompanionRunResult {
  response: string
}

/**
 * Run the companion agent graph.
 *
 * Compiles the graph with the PostgreSQL checkpointer and invokes it
 * with the provided conversation context. The checkpointer automatically
 * handles durability and recovery via thread_id.
 */
export async function runCompanionGraph(
  deps: CompanionRunnerDeps,
  params: RunCompanionParams,
): Promise<CompanionRunResult> {
  const { modelRegistry, checkpointer } = deps
  const { threadId, modelId, systemPrompt, messages } = params

  logger.debug(
    {
      threadId,
      modelId,
      messageCount: messages.length,
    },
    "Running companion graph",
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
    },
  )

  const response = result.finalResponse ?? ""

  logger.info(
    {
      threadId,
      responseLength: response.length,
    },
    "Companion graph completed",
  )

  return { response }
}
