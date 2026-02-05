import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"
import type { StructuredToolInterface } from "@langchain/core/tools"
import {
  createCompanionGraph,
  toLangChainMessages,
  type CompanionGraphCallbacks,
  type RecordStepParams,
  type NewMessageInfo,
} from "./companion-graph"
import {
  createSendMessageTool,
  createWebSearchTool,
  createReadUrlTool,
  createSearchMessagesTool,
  createSearchStreamsTool,
  createSearchUsersTool,
  createGetStreamMessagesTool,
  createSearchAttachmentsTool,
  createGetAttachmentTool,
  createLoadAttachmentTool,
  createLoadPdfSectionTool,
  createLoadFileSectionTool,
  isToolEnabled,
  type SendMessageInput,
  type SendMessageInputWithSources,
  type SendMessageResult,
  type SearchToolsCallbacks,
  type SearchAttachmentsCallbacks,
  type GetAttachmentCallbacks,
  type LoadAttachmentCallbacks,
  type LoadPdfSectionCallbacks,
  type LoadFileSectionCallbacks,
} from "./tools"
import { AgentToolNames, type SourceItem } from "@threa/types"
import type { AI, CostRecorder } from "../lib/ai/ai"
import { getCostTrackingCallbacks } from "../lib/ai/ai"
import { getDebugCallbacks } from "../lib/ai/debug-callback"
import { logger } from "../lib/logger"
import { getLangfuseCallbacks } from "../lib/langfuse"

// Re-export for consumers
export type { RecordStepParams, NewMessageInfo }

const MAX_MESSAGES = 5

/**
 * Content block types for multimodal messages.
 */
type TextContentBlock = { type: "text"; text: string }
type ImageContentBlock = { type: "image_url"; image_url: { url: string } }
type ContentBlock = TextContentBlock | ImageContentBlock
type MessageContent = string | ContentBlock[]

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
  /** Conversation history - supports multimodal content for vision models */
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>
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
  runResearcher?: () => Promise<import("./researcher").ResearcherResult>
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
  /** Check for new messages since a sequence (returns rich info for trace display) */
  checkNewMessages: (streamId: string, sinceSequence: bigint, excludeAuthorId: string) => Promise<NewMessageInfo[]>
  /** Update the last seen sequence on the session */
  updateLastSeenSequence: (sessionId: string, sequence: bigint) => Promise<void>
  /** Optional workspace search callbacks (required if search tools are enabled) */
  search?: SearchToolsCallbacks
  /** Optional attachment callbacks (required if attachment tools are enabled) */
  attachments?: {
    search: SearchAttachmentsCallbacks
    get: GetAttachmentCallbacks
    load: LoadAttachmentCallbacks | undefined
    loadPdfSection: LoadPdfSectionCallbacks | undefined
    loadFileSection: LoadFileSectionCallbacks | undefined
  }
  /** Optional callback to await attachment processing for messages (for multi-modal support) */
  awaitAttachmentProcessing?: (messageIds: string[]) => Promise<void>
  /** Optional callback to record steps in the agent trace */
  recordStep?: (params: RecordStepParams) => Promise<void>
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

    // Add attachment tools if callbacks are provided
    if (callbacks.attachments) {
      if (isToolEnabled(enabledTools, AgentToolNames.SEARCH_ATTACHMENTS)) {
        tools.push(createSearchAttachmentsTool(callbacks.attachments.search))
      }
      if (isToolEnabled(enabledTools, AgentToolNames.GET_ATTACHMENT)) {
        tools.push(createGetAttachmentTool(callbacks.attachments.get))
      }
      // Only add load_attachment if the callback is available (vision models only)
      if (callbacks.attachments.load && isToolEnabled(enabledTools, AgentToolNames.LOAD_ATTACHMENT)) {
        tools.push(createLoadAttachmentTool(callbacks.attachments.load))
      }
      // Add load_pdf_section for loading page ranges from large PDFs
      if (callbacks.attachments.loadPdfSection && isToolEnabled(enabledTools, AgentToolNames.LOAD_PDF_SECTION)) {
        tools.push(createLoadPdfSectionTool(callbacks.attachments.loadPdfSection))
      }
      // Add load_file_section for loading line ranges from large text files
      if (callbacks.attachments.loadFileSection && isToolEnabled(enabledTools, AgentToolNames.LOAD_FILE_SECTION)) {
        tools.push(createLoadFileSectionTool(callbacks.attachments.loadFileSection))
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
      recordStep: callbacks.recordStep,
      awaitAttachmentProcessing: callbacks.awaitAttachmentProcessing,
    }

    // Parse model for metadata
    const parsedModel = ai.parseModel(modelId)

    // Invoke the graph with cost tracking via callbacks
    // Cost recording happens automatically via CostTrackingCallback when LLM calls complete
    let result
    try {
      result = await ai.costTracker.runWithTracking(async () => {
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
              ...getDebugCallbacks(),
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
    } catch (err) {
      // Log error with full details so it appears in Langfuse and logs
      const errorMessage = err instanceof Error ? err.message : String(err)
      const errorStack = err instanceof Error ? err.stack : undefined
      logger.error(
        {
          threadId,
          sessionId,
          streamId,
          error: errorMessage,
          stack: errorStack,
        },
        `Companion graph failed: ${errorMessage}`
      )
      throw err
    }

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
