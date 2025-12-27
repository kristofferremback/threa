import { Annotation, MessagesAnnotation, StateGraph, END } from "@langchain/langgraph"
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages"
import type { ChatOpenAI } from "@langchain/openai"
import type { BaseMessage } from "@langchain/core/messages"
import type { StructuredToolInterface } from "@langchain/core/tools"
import type { RunnableConfig } from "@langchain/core/runnables"
import { AgentToolNames } from "@threa/types"
import { logger } from "../lib/logger"
import type { SourceItem, SendMessageInputWithSources, SendMessageResult } from "./tools"

const MAX_ITERATIONS = 20
const MAX_MESSAGES = 5

/**
 * Callbacks that must be provided when invoking the graph.
 * Passed via configurable in the RunnableConfig.
 */
export interface CompanionGraphCallbacks {
  /** Check for new messages since lastProcessedSequence */
  checkNewMessages: (
    streamId: string,
    sinceSequence: bigint,
    excludeAuthorId: string
  ) => Promise<Array<{ sequence: bigint; content: string; authorId: string }>>
  /** Update the last seen sequence on the session */
  updateLastSeenSequence: (sessionId: string, sequence: bigint) => Promise<void>
  /** Send a message with optional sources (used by ensure_response node) */
  sendMessageWithSources: (input: SendMessageInputWithSources) => Promise<SendMessageResult>
}

/**
 * State annotation for the companion agent graph.
 */
export const CompanionState = Annotation.Root({
  ...MessagesAnnotation.spec,

  systemPrompt: Annotation<string>(),

  // Context tracking
  streamId: Annotation<string>(),
  sessionId: Annotation<string>(),
  personaId: Annotation<string>(),
  lastProcessedSequence: Annotation<bigint>({
    default: () => BigInt(0),
    reducer: (_, next) => next,
  }),

  // Loop tracking
  iteration: Annotation<number>({
    default: () => 0,
    reducer: (prev, next) => (next === 0 ? 0 : prev + 1),
  }),
  messagesSent: Annotation<number>({
    default: () => 0,
    reducer: (prev, next) => (next === -1 ? prev : next),
  }),

  // Final response for backward compatibility
  finalResponse: Annotation<string | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),

  // Flag to indicate new messages were injected (triggers re-evaluation)
  hasNewMessages: Annotation<boolean>({
    default: () => false,
    reducer: (_, next) => next,
  }),

  // Sources extracted from web search results (stored with message metadata)
  sources: Annotation<SourceItem[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),
})

export type CompanionStateType = typeof CompanionState.State

/**
 * Get callbacks from the config's configurable field.
 */
function getCallbacks(config: RunnableConfig): CompanionGraphCallbacks {
  const callbacks = config.configurable?.callbacks as CompanionGraphCallbacks | undefined
  if (!callbacks) {
    throw new Error("CompanionGraphCallbacks must be provided in config.configurable.callbacks")
  }
  return callbacks
}

/**
 * Create the agent node that invokes the LLM.
 */
function createAgentNode(model: ChatOpenAI, tools: StructuredToolInterface[]) {
  const modelWithTools = tools.length > 0 ? model.bindTools(tools) : model

  return async (state: CompanionStateType): Promise<Partial<CompanionStateType>> => {
    // Check iteration limit
    if (state.iteration >= MAX_ITERATIONS) {
      return {
        finalResponse: null,
        iteration: state.iteration, // Keep current value
      }
    }

    const systemMessage = new SystemMessage(state.systemPrompt)
    const response = await modelWithTools.invoke([systemMessage, ...state.messages])

    // Extract text content
    let responseText: string
    if (typeof response.content === "string") {
      responseText = response.content
    } else if (Array.isArray(response.content)) {
      responseText = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
    } else {
      responseText = ""
    }

    logger.debug(
      {
        hasToolCalls: !!response.tool_calls?.length,
        toolCallCount: response.tool_calls?.length ?? 0,
        responseTextLength: responseText.length,
        responseTextPreview: responseText.slice(0, 100),
      },
      "Agent node response"
    )

    return {
      messages: [response],
      finalResponse: responseText,
      iteration: 1, // Increment via reducer
      hasNewMessages: false, // Reset the flag
    }
  }
}

/**
 * Create the check_new_messages node.
 * Checks for new messages and injects them if found.
 */
function createCheckNewMessagesNode() {
  return async (state: CompanionStateType, config: RunnableConfig): Promise<Partial<CompanionStateType>> => {
    const callbacks = getCallbacks(config)

    const newMessages = await callbacks.checkNewMessages(state.streamId, state.lastProcessedSequence, state.personaId)

    if (newMessages.length === 0) {
      return { hasNewMessages: false }
    }

    // Update last seen sequence
    const maxSequence = newMessages.reduce(
      (max, m) => (m.sequence > max ? m.sequence : max),
      state.lastProcessedSequence
    )
    await callbacks.updateLastSeenSequence(state.sessionId, maxSequence)

    // Convert to HumanMessages and inject
    const humanMessages = newMessages.map((m) => new HumanMessage(m.content))

    return {
      messages: humanMessages,
      lastProcessedSequence: maxSequence,
      hasNewMessages: true,
    }
  }
}

/**
 * Extract sources from a web_search tool result.
 */
function extractSourcesFromWebSearch(resultJson: string): SourceItem[] {
  try {
    const content = JSON.parse(resultJson)
    if (content.results && Array.isArray(content.results)) {
      return content.results
        .filter((r: { title?: string; url?: string }) => r.title && r.url)
        .map((r: { title: string; url: string }) => ({ title: r.title, url: r.url }))
    }
  } catch {
    // Not valid JSON or not a search result
  }
  return []
}

/**
 * Create the tools node that executes tool calls.
 * Uses sendMessageWithSources callback for send_message to attach sources from web_search.
 */
function createToolsNode(tools: StructuredToolInterface[]) {
  const toolMap = new Map(tools.map((t) => [t.name, t]))

  return async (state: CompanionStateType, config: RunnableConfig): Promise<Partial<CompanionStateType>> => {
    const callbacks = getCallbacks(config)
    const lastMessage = state.messages[state.messages.length - 1]

    if (!(lastMessage instanceof AIMessage) || !lastMessage.tool_calls?.length) {
      return {}
    }

    // Separate tool calls: execute web_search first to collect sources, then send_message
    const webSearchCalls = lastMessage.tool_calls.filter((tc) => tc.name === "web_search")
    const sendMessageCalls = lastMessage.tool_calls.filter((tc) => tc.name === "send_message")
    const otherCalls = lastMessage.tool_calls.filter((tc) => tc.name !== "web_search" && tc.name !== "send_message")

    const toolMessages: ToolMessage[] = []
    let newMessagesSent = state.messagesSent
    let collectedSources: SourceItem[] = [...state.sources] // Start with any existing sources

    // Execute web_search calls first and collect sources
    for (const toolCall of webSearchCalls) {
      const tool = toolMap.get(toolCall.name)!
      try {
        const result = await tool.invoke(toolCall.args)
        const resultStr = typeof result === "string" ? result : JSON.stringify(result)

        // Extract sources from web_search results
        const sources = extractSourcesFromWebSearch(resultStr)
        collectedSources = [...collectedSources, ...sources]

        toolMessages.push(new ToolMessage({ tool_call_id: toolCall.id!, content: resultStr }))
      } catch (error) {
        toolMessages.push(
          new ToolMessage({ tool_call_id: toolCall.id!, content: JSON.stringify({ error: String(error) }) })
        )
      }
    }

    // Execute other tools (read_url, etc.)
    for (const toolCall of otherCalls) {
      const tool = toolMap.get(toolCall.name)
      if (!tool) {
        toolMessages.push(
          new ToolMessage({
            tool_call_id: toolCall.id!,
            content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
          })
        )
        continue
      }
      try {
        const result = await tool.invoke(toolCall.args)
        toolMessages.push(
          new ToolMessage({
            tool_call_id: toolCall.id!,
            content: typeof result === "string" ? result : JSON.stringify(result),
          })
        )
      } catch (error) {
        toolMessages.push(
          new ToolMessage({ tool_call_id: toolCall.id!, content: JSON.stringify({ error: String(error) }) })
        )
      }
    }

    // Execute send_message calls with collected sources
    for (const toolCall of sendMessageCalls) {
      try {
        const args = toolCall.args as { content: string }

        // Use callback to send message with sources
        const result = await callbacks.sendMessageWithSources({
          content: args.content,
          sources: collectedSources.length > 0 ? collectedSources : undefined,
        })

        newMessagesSent++
        logger.debug(
          { messageId: result.messageId, sourceCount: collectedSources.length },
          "send_message executed with sources via callback"
        )

        toolMessages.push(
          new ToolMessage({
            tool_call_id: toolCall.id!,
            content: JSON.stringify({
              success: true,
              messageId: result.messageId,
              content: result.content,
              messagesSent: newMessagesSent,
            }),
          })
        )
      } catch (error) {
        toolMessages.push(
          new ToolMessage({ tool_call_id: toolCall.id!, content: JSON.stringify({ error: String(error) }) })
        )
      }
    }

    return {
      messages: toolMessages,
      messagesSent: newMessagesSent,
      sources: collectedSources,
    }
  }
}

/**
 * Determine routing after agent node.
 * - If tool calls present → check_new_messages
 * - If no tool calls → check_final_messages
 */
function routeAfterAgent(state: CompanionStateType): "check_new_messages" | "check_final_messages" {
  // Check iteration limit - force end
  if (state.iteration >= MAX_ITERATIONS) {
    return "check_final_messages"
  }

  const lastMessage = state.messages[state.messages.length - 1]

  if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
    return "check_new_messages"
  }

  return "check_final_messages"
}

/**
 * Determine routing after check_new_messages node.
 * - If new messages found → agent (re-evaluate)
 * - If no new messages → tools (execute pending tools)
 */
function routeAfterNewMessageCheck(state: CompanionStateType): "agent" | "tools" {
  return state.hasNewMessages ? "agent" : "tools"
}

/**
 * Determine routing after check_final_messages node.
 * - If new messages found → agent (handle them)
 * - If web search was used → synthesize (format response with citations)
 * - Otherwise → ensure_response
 */
function routeAfterFinalCheck(state: CompanionStateType): "agent" | "synthesize" | "ensure_response" {
  if (state.hasNewMessages) return "agent"

  // Check if web_search was used - if so, route through synthesis for citations
  const usedWebSearch = state.messages.some(
    (m) => m instanceof AIMessage && m.tool_calls?.some((tc) => tc.name === AgentToolNames.WEB_SEARCH)
  )

  logger.debug({ usedWebSearch, messageCount: state.messages.length }, "routeAfterFinalCheck decision")

  return usedWebSearch ? "synthesize" : "ensure_response"
}

/**
 * Extract sources from web_search tool results in the message history.
 */
function extractSearchSources(messages: BaseMessage[]): Array<{ title: string; url: string }> {
  const sources: Array<{ title: string; url: string }> = []
  const seenUrls = new Set<string>()

  for (const msg of messages) {
    if (!(msg instanceof ToolMessage)) continue

    try {
      const content = JSON.parse(msg.content as string)
      if (content.results && Array.isArray(content.results)) {
        for (const result of content.results) {
          if (result.title && result.url && !seenUrls.has(result.url)) {
            seenUrls.add(result.url)
            sources.push({ title: result.title, url: result.url })
          }
        }
      }
    } catch {
      // Not JSON or not a search result, skip
    }
  }

  return sources
}

/**
 * Create the synthesize node.
 * When web search was used, this node extracts sources and stores them in state.
 * Sources are stored as structured data with the message (not appended as text).
 * The UI can render sources in a custom format.
 */
function createSynthesizeNode(_model: ChatOpenAI) {
  return async (state: CompanionStateType): Promise<Partial<CompanionStateType>> => {
    logger.debug("Synthesize node triggered")

    // Extract sources from search results
    const sources = extractSearchSources(state.messages)

    logger.debug({ sourceCount: sources.length, sources }, "Extracted sources for synthesis")

    if (sources.length === 0) {
      logger.debug("No sources found")
      return { sources: [] }
    }

    logger.info({ sourceCount: sources.length }, "Sources extracted and stored in state")

    return { sources }
  }
}

/**
 * Create the ensure_response node.
 * If we're about to end without sending any messages, force send the final response.
 * This handles cases where the model uses tools but forgets to call send_message.
 * Uses the sendMessageWithSources callback to pass sources for storage.
 */
function createEnsureResponseNode() {
  return async (state: CompanionStateType, config: RunnableConfig): Promise<Partial<CompanionStateType>> => {
    const callbacks = getCallbacks(config)

    logger.debug(
      {
        messagesSent: state.messagesSent,
        hasFinalResponse: !!state.finalResponse?.trim(),
        sourceCount: state.sources.length,
      },
      "ensure_response node triggered"
    )

    // Already sent messages - nothing to do
    if (state.messagesSent > 0) {
      logger.debug("Messages already sent, skipping ensure_response")
      return {}
    }

    // No response content to send - edge case, nothing we can do
    if (!state.finalResponse?.trim()) {
      logger.warn("No final response to send")
      return {}
    }

    // Send the final response with sources via callback
    logger.debug(
      { contentLength: state.finalResponse.length, sourceCount: state.sources.length },
      "Sending final response via sendMessageWithSources"
    )

    const result = await callbacks.sendMessageWithSources({
      content: state.finalResponse,
      sources: state.sources.length > 0 ? state.sources : undefined,
    })

    logger.info({ messageId: result.messageId, sourceCount: state.sources.length }, "ensure_response sent message")

    return { messagesSent: state.messagesSent + 1 }
  }
}

/**
 * Create the companion agent graph.
 *
 * Graph structure:
 *   START → agent → (has tool calls?)
 *                     → yes → check_new_messages → (new messages?)
 *                                                    → yes → agent
 *                                                    → no → tools → agent
 *                     → no → check_final_messages → (new messages?)
 *                                                    → yes → agent
 *                                                    → (used web_search?) → yes → synthesize → ensure_response → END
 *                                                                         → no → ensure_response → END
 *
 * The synthesize node formats responses with proper source citations when web search was used.
 * The ensure_response node guarantees we always send at least one message.
 */
export function createCompanionGraph(model: ChatOpenAI, tools: StructuredToolInterface[] = []) {
  const graph = new StateGraph(CompanionState)
    .addNode("agent", createAgentNode(model, tools))
    .addNode("check_new_messages", createCheckNewMessagesNode())
    .addNode("check_final_messages", createCheckNewMessagesNode()) // Same logic, different routing
    .addNode("tools", createToolsNode(tools))
    .addNode("synthesize", createSynthesizeNode(model))
    .addNode("ensure_response", createEnsureResponseNode())
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", routeAfterAgent)
    .addConditionalEdges("check_new_messages", routeAfterNewMessageCheck)
    .addConditionalEdges("check_final_messages", routeAfterFinalCheck)
    .addEdge("tools", "agent")
    .addEdge("synthesize", "ensure_response")
    .addEdge("ensure_response", END)

  return graph
}

/**
 * Convert our message format to LangChain messages.
 */
export function toLangChainMessages(messages: Array<{ role: "user" | "assistant"; content: string }>): BaseMessage[] {
  return messages.map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)))
}
