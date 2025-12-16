import { createCompanionGraph, toLangChainMessages } from "./companion-graph"
import { createChatModel, parseModelId } from "../lib/ai/langchain-provider"
import { getCheckpointer } from "../lib/ai/checkpointer"
import { logger } from "../lib/logger"

/**
 * Dependencies required by the companion runner.
 */
export interface CompanionRunnerDeps {
  apiKey: string
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
  const { apiKey } = deps
  const { threadId, modelId, systemPrompt, messages } = params

  logger.debug(
    {
      threadId,
      modelId,
      messageCount: messages.length,
    },
    "Running companion graph",
  )

  // Parse model ID and create LangChain model
  const parsedModelId = parseModelId(modelId)
  const model = createChatModel(parsedModelId, apiKey)

  // Create and compile graph with checkpointer
  const graph = createCompanionGraph(model)
  const checkpointer = getCheckpointer()
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
