import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"
import type { StructuredToolInterface } from "@langchain/core/tools"
import { createCompanionGraph, toLangChainMessages, type CompanionGraphCallbacks } from "./companion-graph"
import {
  createSendMessageTool,
  createWebSearchTool,
  createReadUrlTool,
  createSearchMessagesTool,
  createSearchStreamsTool,
  createSearchUsersTool,
  createGetStreamMessagesTool,
  isToolEnabled,
  type SendMessageInput,
  type SendMessageInputWithSources,
  type SendMessageResult,
  type SourceItem,
  type SearchToolsCallbacks,
} from "./tools"
import { AgentToolNames } from "@threa/types"
import type { AI, CostRecorder } from "../lib/ai/ai"
import { getCostTrackingCallbacks } from "../lib/ai/ai"
import { logger } from "../lib/logger"
import { getLangfuseCallbacks } from "../lib/langfuse"

const MAX_MESSAGES = 5

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
  /** Stream ID for context */
  streamId: string
  /** Session ID for tracking */
  sessionId: string
  /** Persona ID for excluding own messages from new message checks */
  personaId: string
  /** Last processed sequence for new message detection */
  lastProcessedSequence: bigint
  /** Enabled tools for this persona (null means all tools enabled) */
  enabledTools: string[] | null
  /** Workspace ID for cost tracking - required for cost attribution */
  workspaceId: string
  /** User ID who invoked this response - for cost attribution to the human user */
  invokingUserId?: string
  /** Callback to run the researcher for workspace knowledge retrieval */
  runResearcher?: (
    config: import("@langchain/core/runnables").RunnableConfig
  ) => Promise<import("./researcher").ResearcherResult>
}

/**
 * Result from generating a response.
 */
export interface GenerateResponseResult {
  /** Text response (may be empty if agent used send_message tool) */
  response: string
  /** Number of messages sent via send_message tool */
  messagesSent: number
  /** IDs of messages sent */
  sentMessageIds: string[]
  /** Updated last processed sequence */
  lastProcessedSequence: bigint
}

/**
 * Callbacks required by the response generator.
 */
export interface ResponseGeneratorCallbacks {
  /** Send a message to the stream (used by send_message tool) */
  sendMessage: (input: SendMessageInput) => Promise<SendMessageResult>
  /** Send a message with optional sources (used by ensure_response node) */
  sendMessageWithSources: (input: SendMessageInputWithSources) => Promise<SendMessageResult>
  /** Check for new messages since a sequence */
  checkNewMessages: (
    streamId: string,
    sinceSequence: bigint,
    excludeAuthorId: string
  ) => Promise<Array<{ sequence: bigint; content: string; authorId: string }>>
  /** Update the last seen sequence on the session */
  updateLastSeenSequence: (sessionId: string, sequence: bigint) => Promise<void>
  /** Optional workspace search callbacks (required if search tools are enabled) */
  search?: SearchToolsCallbacks
}

/**
 * Interface for response generators.
 * Allows swapping LangGraph for a stub in tests.
 */
export interface ResponseGenerator {
  run(params: GenerateResponseParams, callbacks: ResponseGeneratorCallbacks): Promise<GenerateResponseResult>
}

/**
 * LangGraph-based response generator.
 * Uses the companion graph with PostgreSQL checkpointing for durability.
 */
export class LangGraphResponseGenerator implements ResponseGenerator {
  constructor(
    private readonly deps: {
      ai: AI
      checkpointer: PostgresSaver
      tavilyApiKey?: string
      /** Optional cost recorder for tracking AI usage costs */
      costRecorder?: CostRecorder
    }
  ) {}

  async run(params: GenerateResponseParams, callbacks: ResponseGeneratorCallbacks): Promise<GenerateResponseResult> {
    const { ai, checkpointer, tavilyApiKey, costRecorder } = this.deps
    const {
      threadId,
      modelId,
      systemPrompt,
      messages,
      streamId,
      sessionId,
      personaId,
      lastProcessedSequence,
      enabledTools,
      workspaceId,
      invokingUserId,
      runResearcher,
    } = params

    logger.debug(
      {
        threadId,
        modelId,
        messageCount: messages.length,
        streamId,
        sessionId,
      },
      "Running companion graph"
    )

    // Track messages sent for the tool
    const sentMessageIds: string[] = []
    let messagesSentCount = 0

    // Create send_message tool
    const sendMessageTool = createSendMessageTool({
      onSendMessage: async (input) => {
        const result = await callbacks.sendMessage(input)
        sentMessageIds.push(result.messageId)
        return result
      },
      maxMessages: MAX_MESSAGES,
      getMessagesSent: () => messagesSentCount,
    })

    // Get LangChain model from AI wrapper
    const model = ai.getLangChainModel(modelId)

    // Create tools array based on persona's enabled tools
    const tools: StructuredToolInterface[] = [sendMessageTool]

    if (tavilyApiKey && isToolEnabled(enabledTools, AgentToolNames.WEB_SEARCH)) {
      tools.push(createWebSearchTool({ tavilyApiKey }))
    }

    if (isToolEnabled(enabledTools, AgentToolNames.READ_URL)) {
      tools.push(createReadUrlTool())
    }

    // Add workspace search tools if callbacks are provided
    if (callbacks.search) {
      if (isToolEnabled(enabledTools, AgentToolNames.SEARCH_MESSAGES)) {
        tools.push(createSearchMessagesTool(callbacks.search))
      }
      if (isToolEnabled(enabledTools, AgentToolNames.SEARCH_STREAMS)) {
        tools.push(createSearchStreamsTool(callbacks.search))
      }
      if (isToolEnabled(enabledTools, AgentToolNames.SEARCH_USERS)) {
        tools.push(createSearchUsersTool(callbacks.search))
      }
      if (isToolEnabled(enabledTools, AgentToolNames.GET_STREAM_MESSAGES)) {
        tools.push(createGetStreamMessagesTool(callbacks.search))
      }
    }

    logger.debug(
      { enabledToolCount: tools.length, toolNames: tools.map((t) => t.name) },
      "Tools configured for session"
    )

    // Create and compile graph with checkpointer
    const graph = createCompanionGraph(model, tools)
    const compiledGraph = graph.compile({ checkpointer })

    // Convert messages to LangChain format
    const langchainMessages = toLangChainMessages(messages)

    // Create graph callbacks
    const graphCallbacks: CompanionGraphCallbacks = {
      checkNewMessages: callbacks.checkNewMessages,
      updateLastSeenSequence: callbacks.updateLastSeenSequence,
      sendMessageWithSources: async (input) => {
        const result = await callbacks.sendMessageWithSources(input)
        sentMessageIds.push(result.messageId)
        messagesSentCount++
        return result
      },
      runResearcher,
    }

    // Parse model for metadata
    const parsedModel = ai.parseModel(modelId)

    // Invoke the graph with cost tracking via callbacks
    // Cost recording happens automatically via CostTrackingCallback when LLM calls complete
    const result = await ai.costTracker.runWithTracking(async () => {
      return compiledGraph.invoke(
        {
          messages: langchainMessages,
          systemPrompt,
          streamId,
          sessionId,
          personaId,
          lastProcessedSequence,
          finalResponse: null,
          iteration: 0,
          messagesSent: 0,
          hasNewMessages: false,
          sources: [],
          retrievedContext: null,
        },
        {
          runName: "companion-agent",
          callbacks: [
            ...getLangfuseCallbacks({
              sessionId,
              userId: personaId,
              tags: ["companion"],
              metadata: {
                model_id: parsedModel.modelId,
                model_provider: parsedModel.modelProvider,
                model_name: parsedModel.modelName,
              },
            }),
            // Cost tracking callback records usage automatically when handleLLMEnd fires
            ...getCostTrackingCallbacks({
              costRecorder,
              workspaceId,
              userId: invokingUserId,
              sessionId,
              functionId: "companion-response",
              origin: "user",
              getCapturedUsage: () => ai.costTracker.getCapturedUsage(),
            }),
          ],
          configurable: {
            thread_id: threadId,
            callbacks: graphCallbacks,
          },
        }
      )
    })

    // Get final usage for logging
    const usage = ai.costTracker.getCapturedUsage()

    // Update tracked count from result
    messagesSentCount = result.messagesSent ?? 0

    const response = result.finalResponse ?? ""

    logger.info(
      {
        threadId,
        responseLength: response.length,
        messagesSent: messagesSentCount,
        sentMessageIds,
        lastProcessedSequence: result.lastProcessedSequence?.toString(),
        cost: usage.cost,
        totalTokens: usage.totalTokens,
      },
      "Companion graph completed"
    )

    return {
      response,
      messagesSent: messagesSentCount,
      sentMessageIds,
      lastProcessedSequence: result.lastProcessedSequence ?? lastProcessedSequence,
    }
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

  async run(params: GenerateResponseParams, callbacks: ResponseGeneratorCallbacks): Promise<GenerateResponseResult> {
    logger.debug({ threadId: params.threadId, messageCount: params.messages.length }, "Running stub response generator")

    // Simulate sending a message via the tool
    const result = await callbacks.sendMessage({ content: this.response })

    return {
      response: this.response,
      messagesSent: 1,
      sentMessageIds: [result.messageId],
      lastProcessedSequence: params.lastProcessedSequence,
    }
  }
}
