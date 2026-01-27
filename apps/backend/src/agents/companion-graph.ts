import { Annotation, MessagesAnnotation, StateGraph, END } from "@langchain/langgraph"
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages"
import type { ChatOpenAI } from "@langchain/openai"
import type { BaseMessage } from "@langchain/core/messages"
import type { StructuredToolInterface } from "@langchain/core/tools"
import type { RunnableConfig } from "@langchain/core/runnables"
import { AgentToolNames, type SourceItem, type AgentStepType, type TraceSource } from "@threa/types"
import { logger } from "../lib/logger"
import type { SendMessageInputWithSources, SendMessageResult } from "./tools"
import type { ResearcherResult } from "./researcher"

/**
 * Parameters for recording a step in the agent trace.
 */
export interface RecordStepParams {
  stepType: AgentStepType
  content?: string
  sources?: TraceSource[]
  messageId?: string
  /** Duration of the step in milliseconds (used to compute completedAt) */
  durationMs?: number
}

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
  /** Run the researcher to retrieve workspace knowledge (optional - if not provided, research is skipped) */
  runResearcher?: (config: RunnableConfig) => Promise<ResearcherResult>
  /** Record a step in the agent trace (optional - if not provided, steps are not recorded) */
  recordStep?: (params: RecordStepParams) => Promise<void>
}

/**
 * A message that has been prepared but not yet sent.
 * Used for the prep-then-send pattern that allows reconsidering
 * if new messages arrive before the response is committed.
 */
export interface PendingMessage {
  content: string
  sources?: SourceItem[]
  preparedAt: number
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

  // Retrieved context from researcher (injected into system prompt)
  retrievedContext: Annotation<string | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),

  // Pending messages awaiting confirmation (prep-then-send pattern)
  // Allows reconsidering response if new messages arrive before sending
  // Multiple messages can be staged if agent calls send_message multiple times in parallel
  pendingMessages: Annotation<PendingMessage[]>({
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
 * Create the research node that retrieves workspace knowledge.
 * This node runs at the start of the graph to gather context before the agent responds.
 */
function createResearchNode() {
  return async (state: CompanionStateType, config: RunnableConfig): Promise<Partial<CompanionStateType>> => {
    const callbacks = getCallbacks(config)

    // Skip if no researcher callback provided
    if (!callbacks.runResearcher) {
      logger.info("Research node skipped - no researcher callback")
      return {}
    }

    logger.info("Research node starting")

    try {
      const startTime = Date.now()
      const result = await callbacks.runResearcher(config)
      const durationMs = Date.now() - startTime

      logger.debug(
        {
          shouldSearch: result.shouldSearch,
          memoCount: result.memos.length,
          messageCount: result.messages.length,
          sourceCount: result.sources.length,
        },
        "Research node completed"
      )

      // Record the workspace search step with enriched source metadata
      if (callbacks.recordStep && (result.memos.length > 0 || result.messages.length > 0)) {
        const traceSources: TraceSource[] = [
          ...result.memos.map((m) => ({
            type: "workspace_memo" as const,
            title: m.memo.title,
            snippet: m.memo.abstract.slice(0, 200),
            streamId: m.sourceStream?.id,
            streamName: m.sourceStream?.name ?? undefined,
          })),
          ...result.messages.map((m) => ({
            type: "workspace_message" as const,
            title: `${m.authorName} in ${m.streamName}`,
            snippet: m.content.slice(0, 200),
            streamId: m.streamId,
            messageId: m.id,
            authorName: m.authorName,
            timestamp: m.createdAt.toISOString(),
          })),
        ]

        await callbacks.recordStep({
          stepType: "workspace_search",
          content: JSON.stringify({ memoCount: result.memos.length, messageCount: result.messages.length }),
          durationMs,
          sources: traceSources,
        })
      }

      // If researcher found sources, add them to the initial sources
      const newSources: SourceItem[] = result.sources.map((s) => ({
        title: s.title,
        url: s.url,
        type: s.type,
        snippet: s.snippet,
      }))

      return {
        retrievedContext: result.retrievedContext,
        sources: [...state.sources, ...newSources],
      }
    } catch (error) {
      logger.warn({ error }, "Research node failed, continuing without workspace context")
      return {}
    }
  }
}

/**
 * Create the agent node that invokes the LLM.
 */
function createAgentNode(model: ChatOpenAI, tools: StructuredToolInterface[]) {
  const modelWithTools = tools.length > 0 ? model.bindTools(tools) : model

  return async (state: CompanionStateType, config: RunnableConfig): Promise<Partial<CompanionStateType>> => {
    const callbacks = getCallbacks(config)

    // Check iteration limit
    if (state.iteration >= MAX_ITERATIONS) {
      return {
        finalResponse: null,
        iteration: state.iteration, // Keep current value
      }
    }

    // Build system prompt with retrieved context if available
    const fullSystemPrompt = state.retrievedContext
      ? `${state.systemPrompt}\n\n${state.retrievedContext}`
      : state.systemPrompt

    const systemMessage = new SystemMessage(fullSystemPrompt)
    const startTime = Date.now()
    const response = await modelWithTools.invoke([systemMessage, ...state.messages])
    const durationMs = Date.now() - startTime

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

    // Record thinking step after LLM call with actual content
    // Skip recording if there's nothing to show (empty response, no tool calls)
    if (callbacks.recordStep) {
      let thinkingContent: string | undefined
      if (responseText.trim()) {
        thinkingContent = responseText
      } else if (response.tool_calls?.length) {
        const toolNames = response.tool_calls.map((tc) => tc.name)
        thinkingContent = JSON.stringify({ toolPlan: toolNames })
      }

      // Only record thinking steps that have content - empty iterations are noise
      if (thinkingContent) {
        await callbacks.recordStep({
          stepType: "thinking",
          content: thinkingContent,
          durationMs,
        })
      }
    }

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
 * Create the finalize_or_reconsider node.
 *
 * This implements the prep-then-send pattern that mimics human reconsideration:
 * - If a message is pending and new messages arrived, give the agent a chance to reconsider
 * - If no new messages, commit the pending message
 * - If no pending message, just check for new messages as usual
 *
 * This allows the agent to "change its mind" if the user adds context before
 * the response is actually sent.
 */
function createFinalizeOrReconsiderNode() {
  return async (state: CompanionStateType, config: RunnableConfig): Promise<Partial<CompanionStateType>> => {
    const callbacks = getCallbacks(config)

    // Check for new messages
    const newMessages = await callbacks.checkNewMessages(state.streamId, state.lastProcessedSequence, state.personaId)
    const hasNewMessages = newMessages.length > 0

    // Update last seen sequence if we found new messages
    let maxSequence = state.lastProcessedSequence
    if (hasNewMessages) {
      maxSequence = newMessages.reduce((max, m) => (m.sequence > max ? m.sequence : max), state.lastProcessedSequence)
      await callbacks.updateLastSeenSequence(state.sessionId, maxSequence)
    }

    // Case 1: No pending messages - just report new messages status
    if (state.pendingMessages.length === 0) {
      if (!hasNewMessages) {
        return { hasNewMessages: false }
      }

      const humanMessages = newMessages.map((m) => new HumanMessage(m.content))
      return {
        messages: humanMessages,
        lastProcessedSequence: maxSequence,
        hasNewMessages: true,
      }
    }

    // Case 2: Pending messages exist
    const pendingMessages = state.pendingMessages

    // Case 2a: No new messages - commit all pending messages
    if (!hasNewMessages) {
      logger.info({ pendingCount: pendingMessages.length }, "No new messages, committing pending messages")

      for (const pending of pendingMessages) {
        const result = await callbacks.sendMessageWithSources({
          content: pending.content,
          sources: pending.sources,
        })
        logger.debug(
          { messageId: result.messageId, contentLength: pending.content.length },
          "Pending message committed"
        )

        // Record the message sent step with sources
        if (callbacks.recordStep) {
          await callbacks.recordStep({
            stepType: "message_sent",
            content: pending.content,
            messageId: result.messageId,
            sources: pending.sources?.map((s) => ({
              type: (s.type ?? "web") as TraceSource["type"],
              title: s.title,
              url: s.url,
              snippet: s.snippet,
            })),
          })
        }
      }

      return {
        pendingMessages: [],
        messagesSent: state.messagesSent + pendingMessages.length,
        hasNewMessages: false,
      }
    }

    // Case 2b: New messages arrived - let the agent reconsider
    // Combine all pending messages into the reconsideration context
    const pendingContents = pendingMessages.map((p) => p.content).join("\n---\n")
    logger.info(
      {
        newMessageCount: newMessages.length,
        pendingCount: pendingMessages.length,
      },
      "New messages arrived while responses pending - agent will reconsider"
    )

    // Record the reconsideration step - this is valuable trace info
    if (callbacks.recordStep) {
      await callbacks.recordStep({
        stepType: "reconsidering",
        content: JSON.stringify({
          draftResponse: pendingContents,
          newMessageCount: newMessages.length,
          newMessages: newMessages.map((m) => m.content.slice(0, 200)),
        }),
      })
    }

    // Build reconsideration context
    const humanMessages = newMessages.map((m) => new HumanMessage(m.content))
    const reconsiderPrompt = new SystemMessage(
      `[New context arrived while you were responding]\n\n` +
        `Your draft response${pendingMessages.length > 1 ? "s were" : " was"}:\n"${pendingContents}"\n\n` +
        `Please respond to all messages, incorporating the new context. ` +
        `You may send the same response${pendingMessages.length > 1 ? "s" : ""} if still appropriate, or revise based on the new information.`
    )

    return {
      messages: [...humanMessages, reconsiderPrompt],
      lastProcessedSequence: maxSequence,
      pendingMessages: [], // Clear pending - agent will re-stage if it wants to send
      hasNewMessages: true,
    }
  }
}

/**
 * Map tool names to semantic step types for the trace.
 */
function getToolStepType(toolName: string): AgentStepType {
  switch (toolName) {
    case "read_url":
      return "visit_page"
    case "search_messages":
    case "search_streams":
    case "search_users":
    case "get_stream_messages":
      return "workspace_search"
    default:
      return "tool_call"
  }
}

/**
 * Format tool execution into structured content and optional sources for the trace.
 * Returns structured JSON (INV-46) — the frontend handles display formatting.
 */
function formatToolStep(
  toolName: string,
  args: Record<string, unknown>,
  resultStr: string
): { content: string; sources?: TraceSource[] } {
  switch (toolName) {
    case "read_url": {
      const url = String(args.url ?? "")
      try {
        const parsed = JSON.parse(resultStr)
        if (parsed.title && parsed.title !== "Untitled") {
          return {
            content: JSON.stringify({ url, title: parsed.title }),
            sources: [{ type: "web", title: parsed.title, url, domain: new URL(url).hostname }],
          }
        }
      } catch {
        // Result wasn't valid JSON or didn't have title
      }
      return { content: JSON.stringify({ url }) }
    }
    case "search_messages":
      return { content: JSON.stringify({ tool: toolName, query: args.query ?? "", stream: args.stream ?? null }) }
    case "search_streams":
      return { content: JSON.stringify({ tool: toolName, query: args.query ?? "" }) }
    case "search_users":
      return { content: JSON.stringify({ tool: toolName, query: args.query ?? "" }) }
    case "get_stream_messages":
      return { content: JSON.stringify({ tool: toolName, stream: args.stream ?? null }) }
    default:
      return { content: JSON.stringify({ tool: toolName, args }) }
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
 *
 * IMPORTANT: send_message calls are STAGED, not sent immediately.
 * This enables the prep-then-send pattern where we can reconsider
 * the message if new user messages arrive before we commit.
 *
 * Uses sendMessageWithSources callback for send_message to attach sources from web_search.
 */
function createToolsNode(tools: StructuredToolInterface[]) {
  const toolMap = new Map(tools.map((t) => [t.name, t]))

  return async (state: CompanionStateType, _config: RunnableConfig): Promise<Partial<CompanionStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1]

    if (!(lastMessage instanceof AIMessage) || !lastMessage.tool_calls?.length) {
      return {}
    }

    // Separate tool calls: execute web_search first to collect sources, then send_message
    const webSearchCalls = lastMessage.tool_calls.filter((tc) => tc.name === "web_search")
    const sendMessageCalls = lastMessage.tool_calls.filter((tc) => tc.name === "send_message")
    const otherCalls = lastMessage.tool_calls.filter((tc) => tc.name !== "web_search" && tc.name !== "send_message")

    const toolMessages: ToolMessage[] = []
    let collectedSources: SourceItem[] = [...state.sources] // Start with any existing sources
    const pendingMessages: PendingMessage[] = []

    const callbacks = getCallbacks(_config)

    // Execute web_search calls first and collect sources
    for (const toolCall of webSearchCalls) {
      const tool = toolMap.get(toolCall.name)!
      const startTime = Date.now()
      try {
        const result = await tool.invoke(toolCall.args)
        const durationMs = Date.now() - startTime
        const resultStr = typeof result === "string" ? result : JSON.stringify(result)

        // Extract sources from web_search results
        const sources = extractSourcesFromWebSearch(resultStr)
        collectedSources = [...collectedSources, ...sources]

        // Record the web search step
        if (callbacks.recordStep) {
          const query = (toolCall.args as { query?: string }).query
          await callbacks.recordStep({
            stepType: "web_search",
            content: query,
            durationMs,
            sources: sources.map((s) => ({
              title: s.title,
              url: s.url,
              type: "web" as const,
            })),
          })
        }

        toolMessages.push(new ToolMessage({ tool_call_id: toolCall.id!, content: resultStr }))
      } catch (error) {
        const durationMs = Date.now() - startTime
        if (callbacks.recordStep) {
          await callbacks.recordStep({
            stepType: "tool_error",
            content: `web_search failed: ${String(error)}`,
            durationMs,
          })
        }
        toolMessages.push(
          new ToolMessage({ tool_call_id: toolCall.id!, content: JSON.stringify({ error: String(error) }) })
        )
      }
    }

    // Execute other tools (read_url, search_messages, etc.)
    for (const toolCall of otherCalls) {
      const tool = toolMap.get(toolCall.name)
      if (!tool) {
        if (callbacks.recordStep) {
          await callbacks.recordStep({
            stepType: "tool_error",
            content: `Unknown tool: ${toolCall.name}`,
          })
        }
        toolMessages.push(
          new ToolMessage({
            tool_call_id: toolCall.id!,
            content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
          })
        )
        continue
      }
      const startTime = Date.now()
      try {
        const result = await tool.invoke(toolCall.args)
        const durationMs = Date.now() - startTime
        const resultStr = typeof result === "string" ? result : JSON.stringify(result)

        // Record step with appropriate type based on tool name
        if (callbacks.recordStep) {
          const stepType = getToolStepType(toolCall.name)
          const { content, sources } = formatToolStep(toolCall.name, toolCall.args, resultStr)
          await callbacks.recordStep({ stepType, content, sources, durationMs })
        }

        toolMessages.push(
          new ToolMessage({
            tool_call_id: toolCall.id!,
            content: resultStr,
          })
        )
      } catch (error) {
        const durationMs = Date.now() - startTime
        if (callbacks.recordStep) {
          await callbacks.recordStep({
            stepType: "tool_error",
            content: `${toolCall.name} failed: ${String(error)}`,
            durationMs,
          })
        }
        toolMessages.push(
          new ToolMessage({ tool_call_id: toolCall.id!, content: JSON.stringify({ error: String(error) }) })
        )
      }
    }

    // Stage send_message calls instead of sending immediately
    // This allows reconsidering if new messages arrive before we commit
    for (const toolCall of sendMessageCalls) {
      try {
        const args = toolCall.args as { content: string }

        // Stage the message - it will be sent in finalize_or_reconsider node
        // Multiple send_message calls are all collected and sent in order
        pendingMessages.push({
          content: args.content,
          sources: collectedSources.length > 0 ? collectedSources : undefined,
          preparedAt: Date.now(),
        })

        logger.debug(
          {
            contentLength: args.content.length,
            sourceCount: collectedSources.length,
            totalPending: pendingMessages.length,
          },
          "send_message staged as pending (prep-then-send)"
        )

        toolMessages.push(
          new ToolMessage({
            tool_call_id: toolCall.id!,
            content: JSON.stringify({
              status: "pending",
              message: "Message staged. Will be sent after checking for new context.",
              contentPreview: args.content.slice(0, 100) + (args.content.length > 100 ? "..." : ""),
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
      sources: collectedSources,
      pendingMessages,
    }
  }
}

/**
 * Determine routing after agent node.
 * - If tool calls present → tools (always execute tool calls first)
 * - If no tool calls → check_final_messages
 */
function routeAfterAgent(state: CompanionStateType): "tools" | "check_final_messages" {
  // Check iteration limit - force end
  if (state.iteration >= MAX_ITERATIONS) {
    return "check_final_messages"
  }

  const lastMessage = state.messages[state.messages.length - 1]

  if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
    // Always execute tools first - never skip them
    return "tools"
  }

  return "check_final_messages"
}

/**
 * Determine routing after tools node.
 * Always go to finalize_or_reconsider to handle pending messages and check for new context.
 */
function routeAfterTools(): "finalize_or_reconsider" {
  return "finalize_or_reconsider"
}

/**
 * Determine routing after finalize_or_reconsider node.
 * Always returns to agent - the agent will decide whether to continue or end.
 */
function routeAfterFinalizeOrReconsider(): "agent" {
  return "agent"
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
 *
 * Also handles edge case where a pending message exists but wasn't committed
 * (shouldn't happen in normal flow, but defensive programming).
 */
function createEnsureResponseNode() {
  return async (state: CompanionStateType, config: RunnableConfig): Promise<Partial<CompanionStateType>> => {
    const callbacks = getCallbacks(config)

    logger.debug(
      {
        messagesSent: state.messagesSent,
        hasFinalResponse: !!state.finalResponse?.trim(),
        pendingCount: state.pendingMessages.length,
        sourceCount: state.sources.length,
      },
      "ensure_response node triggered"
    )

    let currentMessagesSent = state.messagesSent

    // Edge case: If there are pending messages that weren't committed, commit them now
    // This shouldn't happen in normal flow but provides a safety net
    if (state.pendingMessages.length > 0) {
      logger.warn(
        { pendingCount: state.pendingMessages.length },
        "Found uncommitted pending messages in ensure_response - committing"
      )

      for (const pending of state.pendingMessages) {
        const result = await callbacks.sendMessageWithSources({
          content: pending.content,
          sources: pending.sources,
        })
        logger.debug({ messageId: result.messageId }, "Pending message committed in ensure_response")
        currentMessagesSent++
      }
    }

    // Already sent messages - nothing more to do
    if (currentMessagesSent > 0) {
      logger.debug("Messages already sent, skipping ensure_response")
      return {
        messagesSent: currentMessagesSent,
        pendingMessages: [],
      }
    }

    // No response content to send - edge case, nothing we can do
    if (!state.finalResponse?.trim()) {
      logger.warn("No final response to send")
      return { pendingMessages: [] }
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

    // Record the message sent step with sources
    if (callbacks.recordStep) {
      await callbacks.recordStep({
        stepType: "message_sent",
        content: state.finalResponse,
        messageId: result.messageId,
        sources:
          state.sources.length > 0
            ? state.sources.map((s) => ({
                type: (s.type ?? "web") as TraceSource["type"],
                title: s.title,
                url: s.url,
                snippet: s.snippet,
              }))
            : undefined,
      })
    }

    logger.info({ messageId: result.messageId, sourceCount: state.sources.length }, "ensure_response sent message")

    return {
      messagesSent: currentMessagesSent + 1,
      pendingMessages: [],
    }
  }
}

/**
 * Create the companion agent graph.
 *
 * Graph structure:
 *   START → research → agent → (has tool calls?)
 *                                → yes → tools → finalize_or_reconsider → agent (loop)
 *                                → no → check_final_messages → (new messages?)
 *                                                               → yes → agent
 *                                                               → (used web_search?) → yes → synthesize → ensure_response → END
 *                                                                                    → no → ensure_response → END
 *
 * CRITICAL: Tool calls are ALWAYS executed before checking for new messages.
 * This prevents tool calls from being dropped when users send additional messages
 * while the agent is processing.
 *
 * PREP-THEN-SEND: The send_message tool stages messages instead of sending immediately.
 * The finalize_or_reconsider node checks for new messages before committing:
 * - If no new messages: commits the pending message
 * - If new messages arrived: gives the agent a chance to reconsider its response
 * This mimics human reconsideration behavior when new context arrives.
 *
 * The research node retrieves workspace knowledge before the agent responds.
 * The synthesize node formats responses with proper source citations when web search was used.
 * The ensure_response node guarantees we always send at least one message.
 */
export function createCompanionGraph(model: ChatOpenAI, tools: StructuredToolInterface[] = []) {
  const graph = new StateGraph(CompanionState)
    .addNode("research", createResearchNode())
    .addNode("agent", createAgentNode(model, tools))
    .addNode("finalize_or_reconsider", createFinalizeOrReconsiderNode())
    .addNode("check_final_messages", createCheckNewMessagesNode()) // Same logic, different routing
    .addNode("tools", createToolsNode(tools))
    .addNode("synthesize", createSynthesizeNode(model))
    .addNode("ensure_response", createEnsureResponseNode())
    .addEdge("__start__", "research")
    .addEdge("research", "agent")
    .addConditionalEdges("agent", routeAfterAgent)
    // Tools execute, then finalize_or_reconsider handles pending messages and new context
    .addConditionalEdges("tools", routeAfterTools)
    .addConditionalEdges("finalize_or_reconsider", routeAfterFinalizeOrReconsider)
    .addConditionalEdges("check_final_messages", routeAfterFinalCheck)
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
