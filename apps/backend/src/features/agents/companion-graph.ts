import { Annotation, StateGraph, END } from "@langchain/langgraph"
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages"
import type { ChatOpenAI } from "@langchain/openai"
import type { BaseMessage } from "@langchain/core/messages"
import type { StructuredToolInterface } from "@langchain/core/tools"
import type { RunnableConfig } from "@langchain/core/runnables"
import { AgentToolNames, type AuthorType, type SourceItem, type AgentStepType, type TraceSource } from "@threa/types"
import { logger } from "../../lib/logger"
import type { SendMessageInputWithSources, SendMessageResult, WorkspaceResearchToolResult } from "./tools"
import { isMultimodalToolResult } from "./tools"
import { protectToolOutputBlocks, protectToolOutputText, type MultimodalContentBlock } from "./tool-trust-boundary"

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
const WORKSPACE_RESEARCH_TOOL_NAME = "workspace_research"
const ENSURE_RESPONSE_FALLBACK_MESSAGE =
  "I am sorry, I could not complete a proper response yet. Please send one more message and I will retry."

/**
 * Maximum context size in characters for messages sent to the model.
 * This is a conservative limit to stay well under the 200k token limit.
 * Roughly 4 chars per token, so 400k chars ≈ 100k tokens.
 */
const MAX_MESSAGE_CHARS = 400_000

/**
 * Maximum size for any single message in characters.
 * Individual messages larger than this will be truncated.
 * This prevents a single huge message from consuming all context.
 */
const MAX_SINGLE_MESSAGE_CHARS = 50_000

/**
 * Get the character length of a message's content.
 */
function getMessageLength(message: BaseMessage): number {
  if (typeof message.content === "string") {
    return message.content.length
  }
  if (Array.isArray(message.content)) {
    return message.content.reduce((sum: number, part: unknown) => {
      if (typeof part === "string") return sum + part.length
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        (part as { type: string }).type === "text" &&
        "text" in part
      ) {
        return sum + ((part as { text?: string }).text?.length ?? 0)
      }
      return sum
    }, 0)
  }
  return 0
}

/**
 * Get the type string for a message using static isInstance checks.
 */
function getMessageType(message: BaseMessage): string {
  if (HumanMessage.isInstance(message)) return "human"
  if (AIMessage.isInstance(message)) return "ai"
  if (SystemMessage.isInstance(message)) return "system"
  if (ToolMessage.isInstance(message)) return "tool"
  return "unknown"
}

/**
 * Truncate a single message's content if it exceeds the limit.
 * Returns a new message with truncated content, or the original if no truncation needed.
 */
function truncateSingleMessage(message: BaseMessage, maxChars: number): BaseMessage {
  const length = getMessageLength(message)
  if (length <= maxChars) return message

  const messageType = getMessageType(message)
  logger.warn({ messageLength: length, maxChars, messageType }, "Truncating oversized message")

  // Truncate the content
  if (typeof message.content === "string") {
    const truncated = message.content.slice(0, maxChars) + "\n\n[... content truncated due to length ...]"
    switch (true) {
      case HumanMessage.isInstance(message):
        return new HumanMessage({ content: truncated, id: message.id })
      case AIMessage.isInstance(message):
        return new AIMessage({
          content: truncated,
          id: message.id,
          tool_calls: message.tool_calls,
        })
      case SystemMessage.isInstance(message):
        return new SystemMessage({ content: truncated, id: message.id })
      case ToolMessage.isInstance(message):
        return new ToolMessage({
          content: truncated,
          tool_call_id: message.tool_call_id,
        })
      default:
        logger.warn({ messageType }, "Unknown message type in truncation, creating generic message")
        return new HumanMessage({ content: truncated, id: message.id })
    }
  }

  // For array content (multimodal), truncate text parts
  if (Array.isArray(message.content)) {
    let remainingChars = maxChars
    const truncatedContent: unknown[] = []

    for (const part of message.content as unknown[]) {
      const isTextBlock =
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        (part as { type: string }).type === "text" &&
        "text" in part

      switch (true) {
        case typeof part === "string":
          if (part.length <= remainingChars) {
            truncatedContent.push(part)
            remainingChars -= part.length
          } else {
            truncatedContent.push(part.slice(0, remainingChars) + "\n\n[... content truncated ...]")
            remainingChars = 0
          }
          break
        case isTextBlock: {
          const textPart = part as { type: string; text: string }
          if (textPart.text.length <= remainingChars) {
            truncatedContent.push(part)
            remainingChars -= textPart.text.length
          } else {
            truncatedContent.push({
              type: "text",
              text: textPart.text.slice(0, remainingChars) + "\n\n[... content truncated ...]",
            })
            remainingChars = 0
          }
          break
        }
        default:
          // Keep non-text parts (images, etc.)
          truncatedContent.push(part)
      }
      if (remainingChars === 0) break
    }

    switch (true) {
      case HumanMessage.isInstance(message):
        return new HumanMessage({ content: truncatedContent as HumanMessage["content"], id: message.id })
      case AIMessage.isInstance(message):
        return new AIMessage({
          content: truncatedContent as AIMessage["content"],
          id: message.id,
          tool_calls: message.tool_calls,
        })
      case ToolMessage.isInstance(message):
        return new ToolMessage({
          content: truncatedContent as ToolMessage["content"],
          tool_call_id: message.tool_call_id,
        })
      default:
        logger.warn({ messageType }, "Unknown message type with array content in truncation")
        return new HumanMessage({ content: truncatedContent as HumanMessage["content"], id: message.id })
    }
  }

  // Fallback: if we get here, log and return truncated as HumanMessage
  logger.warn({ messageType, contentType: typeof message.content }, "Unhandled content type in truncation")
  return message
}

/**
 * Truncate messages to stay within context limits.
 * Keeps recent messages, preserving tool call/response pairs.
 *
 * Strategy:
 * 1. First, truncate any individual messages that are too large
 * 2. Calculate total length of all messages
 * 3. If under limit, return all messages
 * 4. Otherwise, keep the most recent messages that fit
 * 5. Always keep at least the last message for context
 */
function truncateMessages(messages: BaseMessage[], maxChars: number): BaseMessage[] {
  if (messages.length === 0) return messages

  // First pass: truncate any oversized individual messages
  const truncatedIndividual = messages.map((msg) => truncateSingleMessage(msg, MAX_SINGLE_MESSAGE_CHARS))

  // Calculate total length after individual truncation
  let totalLength = 0
  for (const msg of truncatedIndividual) {
    totalLength += getMessageLength(msg)
  }

  // If under limit, return all (after individual truncation)
  if (totalLength <= maxChars) return truncatedIndividual

  logger.warn(
    { totalLength, maxChars, messageCount: truncatedIndividual.length },
    "Truncating messages to stay within context limit"
  )

  // Build from the end, keeping messages until we hit the limit
  const kept: BaseMessage[] = []
  let keptLength = 0

  // Walk backwards through messages
  for (let i = truncatedIndividual.length - 1; i >= 0; i--) {
    const msg = truncatedIndividual[i]
    const msgLength = getMessageLength(msg)

    // If adding this message would exceed limit, stop
    // But always keep at least 1 message
    if (keptLength + msgLength > maxChars && kept.length > 0) {
      break
    }

    kept.unshift(msg)
    keptLength += msgLength
  }

  logger.info(
    { keptLength, keptCount: kept.length, droppedCount: truncatedIndividual.length - kept.length },
    "Messages truncated"
  )

  return kept
}

/**
 * A new message that arrived during agent processing.
 * Includes rich metadata for trace display.
 */
export interface NewMessageInfo {
  sequence: bigint
  messageId: string
  content: string
  authorId: string
  authorName: string
  authorType: AuthorType
  createdAt: string
}

/**
 * Callbacks that must be provided when invoking the graph.
 * Passed via configurable in the RunnableConfig.
 */
export interface CompanionGraphCallbacks {
  /** Check for new messages since lastProcessedSequence */
  checkNewMessages: (streamId: string, sinceSequence: bigint, excludeAuthorId: string) => Promise<NewMessageInfo[]>
  /** Update the last seen sequence on the session */
  updateLastSeenSequence: (sessionId: string, sequence: bigint) => Promise<void>
  /** Send a message with optional sources (used by ensure_response node) */
  sendMessageWithSources: (input: SendMessageInputWithSources) => Promise<SendMessageResult>
  /** Record a step in the agent trace (optional - if not provided, steps are not recorded) */
  recordStep?: (params: RecordStepParams) => Promise<void>
  /** Await attachment processing for messages (optional - for multi-modal support) */
  awaitAttachmentProcessing?: (messageIds: string[]) => Promise<void>
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
 * Custom messages reducer that truncates to prevent context explosion.
 * Unlike MessagesAnnotation's default reducer which accumulates indefinitely,
 * this applies truncation when messages are updated.
 */
function messagesReducer(current: BaseMessage[], incoming: BaseMessage[]): BaseMessage[] {
  // Combine current and incoming, then truncate to stay within limits
  const combined = [...current, ...incoming]
  return truncateMessages(combined, MAX_MESSAGE_CHARS)
}

/**
 * State annotation for the companion agent graph.
 * Uses a custom messages reducer that truncates on accumulation to prevent
 * context explosion from checkpoint state.
 */
export const CompanionState = Annotation.Root({
  // Custom messages channel with truncating reducer
  messages: Annotation<BaseMessage[]>({
    default: () => [],
    reducer: messagesReducer,
  }),

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

  // Retrieved context from workspace_research tool (injected into system prompt)
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

    // Truncate messages to stay within context limits
    // This prevents context explosion from accumulated checkpoint state
    const truncatedMessages = truncateMessages(state.messages, MAX_MESSAGE_CHARS)

    const startTime = Date.now()
    const response = await modelWithTools.invoke([systemMessage, ...truncatedMessages])
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
 * Records a context_received step when new messages are discovered.
 * If new messages have images that are still processing, waits for them.
 */
function createCheckNewMessagesNode() {
  return async (state: CompanionStateType, config: RunnableConfig): Promise<Partial<CompanionStateType>> => {
    const callbacks = getCallbacks(config)

    const newMessages = await callbacks.checkNewMessages(state.streamId, state.lastProcessedSequence, state.personaId)

    if (newMessages.length === 0) {
      return { hasNewMessages: false }
    }

    // Await attachment processing for new messages if callback is provided
    // This ensures we have captions/extractions before the agent processes the messages
    if (callbacks.awaitAttachmentProcessing) {
      const messageIds = newMessages.map((m) => m.messageId)
      await callbacks.awaitAttachmentProcessing(messageIds)
    }

    // Update last seen sequence
    const maxSequence = newMessages.reduce(
      (max, m) => (m.sequence > max ? m.sequence : max),
      state.lastProcessedSequence
    )
    await callbacks.updateLastSeenSequence(state.sessionId, maxSequence)

    // Record the new messages being added to context
    // This helps users see what additional messages the agent considered
    if (callbacks.recordStep) {
      await callbacks.recordStep({
        stepType: "context_received",
        content: JSON.stringify({
          messages: newMessages.map((m) => ({
            messageId: m.messageId,
            authorName: m.authorName,
            authorType: m.authorType,
            createdAt: m.createdAt,
            content: m.content.slice(0, 300), // Preview
          })),
        }),
      })
    }

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

    // Await attachment processing for new messages if callback is provided
    // This ensures we have captions/extractions before the agent reconsiders
    if (hasNewMessages && callbacks.awaitAttachmentProcessing) {
      const messageIds = newMessages.map((m) => m.messageId)
      await callbacks.awaitAttachmentProcessing(messageIds)
    }

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

    // Record the reconsideration step with rich message context
    // This helps users see exactly what new context caused the agent to reconsider
    if (callbacks.recordStep) {
      await callbacks.recordStep({
        stepType: "reconsidering",
        content: JSON.stringify({
          draftResponse: pendingContents,
          newMessages: newMessages.map((m) => ({
            messageId: m.messageId,
            authorName: m.authorName,
            authorType: m.authorType,
            createdAt: m.createdAt,
            content: m.content.slice(0, 300), // Preview
          })),
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
    case AgentToolNames.READ_URL:
      return "visit_page"
    case WORKSPACE_RESEARCH_TOOL_NAME:
      return "workspace_search"
    case AgentToolNames.SEARCH_MESSAGES:
    case AgentToolNames.SEARCH_STREAMS:
    case AgentToolNames.SEARCH_USERS:
    case AgentToolNames.GET_STREAM_MESSAGES:
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
    case AgentToolNames.READ_URL: {
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
    case AgentToolNames.SEARCH_MESSAGES:
      return { content: JSON.stringify({ tool: toolName, query: args.query ?? "", stream: args.stream ?? null }) }
    case AgentToolNames.SEARCH_STREAMS:
      return { content: JSON.stringify({ tool: toolName, query: args.query ?? "" }) }
    case AgentToolNames.SEARCH_USERS:
      return { content: JSON.stringify({ tool: toolName, query: args.query ?? "" }) }
    case AgentToolNames.GET_STREAM_MESSAGES:
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

function parseWorkspaceResearchResult(resultJson: string): WorkspaceResearchToolResult | null {
  try {
    const parsed = JSON.parse(resultJson) as Partial<WorkspaceResearchToolResult>
    if (!parsed || typeof parsed !== "object") return null

    return {
      shouldSearch: parsed.shouldSearch === true,
      retrievedContext: typeof parsed.retrievedContext === "string" ? parsed.retrievedContext : null,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      memoCount: typeof parsed.memoCount === "number" ? parsed.memoCount : 0,
      messageCount: typeof parsed.messageCount === "number" ? parsed.messageCount : 0,
      attachmentCount: typeof parsed.attachmentCount === "number" ? parsed.attachmentCount : 0,
    }
  } catch {
    return null
  }
}

function mergeSourceItems(existing: SourceItem[], incoming: SourceItem[]): SourceItem[] {
  if (incoming.length === 0) return existing

  const merged: SourceItem[] = [...existing]
  const seen = new Set(merged.map((source) => `${source.url}|${source.title}`))

  for (const source of incoming) {
    const key = `${source.url}|${source.title}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(source)
  }

  return merged
}

function toSourceItems(
  sources: Array<{ title: string; url: string; type: "web" | "workspace"; snippet?: string }>
): SourceItem[] {
  return sources
    .filter((source) => source.title && source.url)
    .map((source) => ({
      title: source.title,
      url: source.url,
      type: source.type,
      snippet: source.snippet,
    }))
}

function createPrefetchWorkspaceResearchNode(tools: StructuredToolInterface[]) {
  const workspaceResearchTool = tools.find((tool) => tool.name === WORKSPACE_RESEARCH_TOOL_NAME)

  return async (state: CompanionStateType, config: RunnableConfig): Promise<Partial<CompanionStateType>> => {
    if (!workspaceResearchTool) {
      return {}
    }

    const callbacks = getCallbacks(config)
    const startTime = Date.now()
    try {
      const result = await workspaceResearchTool.invoke({
        reason: "Initial workspace memory prefetch before composing a response",
      })
      const durationMs = Date.now() - startTime
      const resultStr = typeof result === "string" ? result : JSON.stringify(result)
      const parsed = parseWorkspaceResearchResult(resultStr)
      if (!parsed) {
        throw new Error("workspace_research returned malformed JSON during prefetch")
      }
      const prefetchedSources = toSourceItems(parsed.sources)
      const mergedSources = mergeSourceItems(state.sources, prefetchedSources)
      const retrievedContext = parsed.retrievedContext?.trim() ? parsed.retrievedContext.trim() : state.retrievedContext

      logger.info(
        {
          streamId: state.streamId,
          sessionId: state.sessionId,
          shouldSearch: parsed.shouldSearch,
          sourceCount: prefetchedSources.length,
          memoCount: parsed.memoCount,
          messageCount: parsed.messageCount,
          attachmentCount: parsed.attachmentCount,
        },
        "Workspace research prefetch completed"
      )

      if (callbacks.recordStep) {
        await callbacks.recordStep({
          stepType: "workspace_search",
          content: JSON.stringify({
            mode: "entrypoint_prefetch",
            shouldSearch: parsed.shouldSearch,
            sourceCount: prefetchedSources.length,
            memoCount: parsed.memoCount,
            messageCount: parsed.messageCount,
            attachmentCount: parsed.attachmentCount,
          }),
          durationMs,
          sources: prefetchedSources.map((source) => ({
            type: (source.type ?? "workspace") as TraceSource["type"],
            title: source.title,
            url: source.url,
            snippet: source.snippet,
          })),
        })
      }

      return {
        sources: mergedSources,
        retrievedContext,
      }
    } catch (error) {
      logger.warn(
        { error, streamId: state.streamId, sessionId: state.sessionId },
        "Workspace research prefetch failed; continuing without prefetch"
      )
      if (callbacks.recordStep) {
        await callbacks.recordStep({
          stepType: "tool_error",
          content: `workspace_research prefetch failed: ${String(error)}`,
        })
      }
      return {}
    }
  }
}

/**
 * Create the tools node that executes tool calls.
 *
 * IMPORTANT: send_message calls are STAGED, not sent immediately.
 * This enables the prep-then-send pattern where we can reconsider
 * the message if new user messages arrive before we commit.
 *
 * Sources collected from web_search and workspace_research are attached to send_message.
 */
function createToolsNode(tools: StructuredToolInterface[]) {
  const toolMap = new Map(tools.map((t) => [t.name, t]))

  return async (state: CompanionStateType, _config: RunnableConfig): Promise<Partial<CompanionStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1]

    // Type guards work on deserialized messages and provide proper TypeScript narrowing
    if (!AIMessage.isInstance(lastMessage) || !lastMessage.tool_calls?.length) {
      return {}
    }

    // Separate tool calls: execute web_search first to collect sources, then send_message
    const webSearchCalls = lastMessage.tool_calls.filter((tc) => tc.name === AgentToolNames.WEB_SEARCH)
    const sendMessageCalls = lastMessage.tool_calls.filter((tc) => tc.name === AgentToolNames.SEND_MESSAGE)
    const otherCalls = lastMessage.tool_calls.filter(
      (tc) => tc.name !== AgentToolNames.WEB_SEARCH && tc.name !== AgentToolNames.SEND_MESSAGE
    )

    const toolMessages: ToolMessage[] = []
    let collectedSources: SourceItem[] = [...state.sources] // Start with any existing sources
    let retrievedContext: string | null = state.retrievedContext
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
        collectedSources = mergeSourceItems(collectedSources, sources)

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

        toolMessages.push(new ToolMessage({ tool_call_id: toolCall.id!, content: protectToolOutputText(resultStr) }))
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

        if (toolCall.name === WORKSPACE_RESEARCH_TOOL_NAME) {
          const resultStr = typeof result === "string" ? result : JSON.stringify(result)
          const parsed = parseWorkspaceResearchResult(resultStr)

          if (!parsed) {
            throw new Error("workspace_research returned malformed JSON")
          }

          const workspaceSources = toSourceItems(parsed.sources)
          if (workspaceSources.length > 0) {
            collectedSources = mergeSourceItems(collectedSources, workspaceSources)
          }

          if (parsed.retrievedContext?.trim()) {
            retrievedContext = parsed.retrievedContext.trim()
          }

          if (callbacks.recordStep) {
            await callbacks.recordStep({
              stepType: "workspace_search",
              content: JSON.stringify({
                shouldSearch: parsed.shouldSearch,
                memoCount: parsed.memoCount,
                messageCount: parsed.messageCount,
                attachmentCount: parsed.attachmentCount,
              }),
              durationMs,
              sources: workspaceSources.map((source) => ({
                type: "workspace",
                title: source.title,
                url: source.url,
                snippet: source.snippet,
              })),
            })
          }

          toolMessages.push(
            new ToolMessage({
              tool_call_id: toolCall.id!,
              content: protectToolOutputText(
                JSON.stringify({
                  status: "ok",
                  contextAdded: Boolean(parsed.retrievedContext?.trim()),
                  sourceCount: workspaceSources.length,
                  memoCount: parsed.memoCount,
                  messageCount: parsed.messageCount,
                  attachmentCount: parsed.attachmentCount,
                })
              ),
            })
          )
          continue
        }

        // Check if this is a multimodal result (e.g., from load_attachment)
        // Multimodal results have content blocks that vision models can see
        if (isMultimodalToolResult(result)) {
          logger.debug(
            { toolName: toolCall.name, contentBlocks: result.content.length },
            "Tool returned multimodal content"
          )

          // Record step with text content only
          if (callbacks.recordStep) {
            const stepType = getToolStepType(toolCall.name)
            const textContent = result.content
              .filter((block): block is { type: "text"; text: string } => block.type === "text")
              .map((block) => block.text)
              .join("\n")
            await callbacks.recordStep({ stepType, content: textContent, durationMs })
          }

          // Create ToolMessage with multimodal content blocks
          // This allows vision models to actually "see" images in tool results
          toolMessages.push(
            new ToolMessage({
              tool_call_id: toolCall.id!,
              content: protectToolOutputBlocks(result.content as MultimodalContentBlock[]),
            })
          )
        } else {
          // Standard string result
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
              content: protectToolOutputText(resultStr),
            })
          )
        }
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
      retrievedContext,
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

  // Type guards work on deserialized messages and provide proper TypeScript narrowing
  if (AIMessage.isInstance(lastMessage) && lastMessage.tool_calls?.length) {
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
  // Type guards work on deserialized messages and provide proper TypeScript narrowing
  const usedWebSearch = state.messages.some(
    (m) => AIMessage.isInstance(m) && m.tool_calls?.some((tc) => tc.name === AgentToolNames.WEB_SEARCH)
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
    // Type guards work on deserialized messages and provide proper TypeScript narrowing
    if (!ToolMessage.isInstance(msg)) continue

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
    const webSources = extractSearchSources(state.messages)

    logger.debug({ sourceCount: webSources.length, sources: webSources }, "Extracted sources for synthesis")

    if (webSources.length === 0) {
      logger.debug("No web sources found, preserving existing sources")
      return { sources: state.sources }
    }

    const mergedSources = mergeSourceItems(
      state.sources,
      webSources.map((source) => ({
        title: source.title,
        url: source.url,
        type: "web" as const,
      }))
    )

    logger.info(
      { sourceCount: mergedSources.length, webSourceCount: webSources.length },
      "Sources merged and stored in state"
    )

    return { sources: mergedSources }
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

    const contentToSend = state.finalResponse?.trim() ? state.finalResponse : ENSURE_RESPONSE_FALLBACK_MESSAGE
    const isFallbackSend = !state.finalResponse?.trim()
    if (isFallbackSend) {
      logger.warn("No final response to send, using fallback message")
    }

    // Send the final response with sources via callback
    logger.debug(
      { contentLength: contentToSend.length, sourceCount: state.sources.length, isFallbackSend },
      "Sending final response via sendMessageWithSources"
    )

    const result = await callbacks.sendMessageWithSources({
      content: contentToSend,
      sources: state.sources.length > 0 ? state.sources : undefined,
    })

    // Record the message sent step with sources
    if (callbacks.recordStep) {
      await callbacks.recordStep({
        stepType: "message_sent",
        content: contentToSend,
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

    logger.info(
      { messageId: result.messageId, sourceCount: state.sources.length, isFallbackSend },
      "ensure_response sent message"
    )

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
 *   START → prefetch_workspace_research → agent → (has tool calls?)
 *                                         → yes → tools → finalize_or_reconsider → agent (loop)
 *                                         → no → check_final_messages → (new messages?)
 *                                                                      → yes → agent
 *                                                                      → (used web_search?) → yes → synthesize → ensure_response → END
 *                                                                                           → no → ensure_response → END
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
 * Workspace knowledge retrieval runs as an entrypoint graph prefetch by invoking the
 * workspace_research tool directly, while remaining available on-demand in later turns.
 * The synthesize node formats responses with proper source citations when web search was used.
 * The ensure_response node guarantees we always send at least one message.
 */
export function createCompanionGraph(model: ChatOpenAI, tools: StructuredToolInterface[] = []) {
  const graph = new StateGraph(CompanionState)
    .addNode("prefetch_workspace_research", createPrefetchWorkspaceResearchNode(tools))
    .addNode("agent", createAgentNode(model, tools))
    .addNode("finalize_or_reconsider", createFinalizeOrReconsiderNode())
    .addNode("check_final_messages", createCheckNewMessagesNode()) // Same logic, different routing
    .addNode("tools", createToolsNode(tools))
    .addNode("synthesize", createSynthesizeNode(model))
    .addNode("ensure_response", createEnsureResponseNode())
    .addEdge("__start__", "prefetch_workspace_research")
    .addEdge("prefetch_workspace_research", "agent")
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
 * Content block types for multimodal messages.
 */
type TextContentBlock = { type: "text"; text: string }
type ImageContentBlock = { type: "image_url"; image_url: { url: string } }
type ContentBlock = TextContentBlock | ImageContentBlock
type MessageContent = string | ContentBlock[]

/**
 * Convert our message format to LangChain messages.
 * Supports both string content and multimodal content blocks.
 */
export function toLangChainMessages(
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>
): BaseMessage[] {
  return messages.map((m) => {
    // LangChain's HumanMessage/AIMessage accept both string and array content
    return m.role === "user" ? new HumanMessage({ content: m.content }) : new AIMessage({ content: m.content })
  })
}
