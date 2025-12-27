import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"
import type { StructuredToolInterface } from "@langchain/core/tools"
import { createCompanionGraph, toLangChainMessages, type CompanionGraphCallbacks } from "./companion-graph"
import {
  createSendMessageTool,
  createWebSearchTool,
  createReadUrlTool,
  isToolEnabled,
  type SendMessageInput,
  type SendMessageResult,
} from "./tools"
import { AgentToolNames } from "@threa/types"
import type { ProviderRegistry } from "../lib/ai"
import { logger } from "../lib/logger"

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
  /** Send a message to the stream */
  sendMessage: (input: SendMessageInput) => Promise<SendMessageResult>
  /** Check for new messages since a sequence */
  checkNewMessages: (
    streamId: string,
    sinceSequence: bigint,
    excludeAuthorId: string
  ) => Promise<Array<{ sequence: bigint; content: string; authorId: string }>>
  /** Update the last seen sequence on the session */
  updateLastSeenSequence: (sessionId: string, sequence: bigint) => Promise<void>
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
      modelRegistry: ProviderRegistry
      checkpointer: PostgresSaver
      tavilyApiKey?: string
    }
  ) {}

  async run(params: GenerateResponseParams, callbacks: ResponseGeneratorCallbacks): Promise<GenerateResponseResult> {
    const { modelRegistry, checkpointer, tavilyApiKey } = this.deps
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

    // Get LangChain model from registry
    const model = modelRegistry.getLangChainModel(modelId)

    // Create tools array based on persona's enabled tools
    const tools: StructuredToolInterface[] = [sendMessageTool]

    if (tavilyApiKey && isToolEnabled(enabledTools, AgentToolNames.WEB_SEARCH)) {
      tools.push(createWebSearchTool({ tavilyApiKey }))
    }

    if (isToolEnabled(enabledTools, AgentToolNames.READ_URL)) {
      tools.push(createReadUrlTool())
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
    }

    // Invoke the graph
    const result = await compiledGraph.invoke(
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
      },
      {
        configurable: {
          thread_id: threadId,
          callbacks: graphCallbacks,
        },
      }
    )

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
