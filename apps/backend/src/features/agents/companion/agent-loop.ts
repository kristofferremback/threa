import type { LanguageModel, ModelMessage, Tool, ToolCallPart, ToolResultPart } from "ai"
import type { SourceItem, AgentStepType, TraceSource, AuthorType } from "@threa/types"
import { AgentToolNames } from "@threa/types"
import { trace, SpanStatusCode } from "@opentelemetry/api"
import type { AI } from "../../../lib/ai/ai"
import { logger } from "../../../lib/logger"
import { protectToolOutputText } from "../tool-trust-boundary"
import { isMultimodalToolResult } from "../tools"
import { MAX_MESSAGE_CHARS, truncateMessages } from "./truncation"
import { extractSourcesFromWebSearch, parseWorkspaceResearchResult, mergeSourceItems, toSourceItems } from "./sources"

const tracer = trace.getTracer("companion-agent")

const MAX_ITERATIONS = 20
const WORKSPACE_RESEARCH_TOOL = "workspace_research"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NewMessageInfo {
  sequence: bigint
  messageId: string
  content: string
  authorId: string
  authorName: string
  authorType: AuthorType
  createdAt: string
}

export interface RecordStepParams {
  stepType: AgentStepType
  content?: string
  sources?: TraceSource[]
  messageId?: string
  durationMs?: number
}

export interface AgentLoopInput {
  ai: AI
  model: LanguageModel
  systemPrompt: string
  messages: ModelMessage[]
  tools: Record<string, Tool<any, any>>
  streamId: string
  sessionId: string
  personaId: string
  lastProcessedSequence: bigint
  telemetry?: { functionId: string; metadata?: Record<string, string | number | boolean> }
}

export interface AgentLoopCallbacks {
  sendMessage: (input: { content: string; sources?: SourceItem[] }) => Promise<{ messageId: string }>
  checkNewMessages: (streamId: string, sinceSequence: bigint, excludeAuthorId: string) => Promise<NewMessageInfo[]>
  updateLastSeenSequence: (sessionId: string, sequence: bigint) => Promise<void>
  recordStep: (params: RecordStepParams) => Promise<void>
  awaitAttachmentProcessing: (messageIds: string[]) => Promise<void>
}

export interface AgentLoopResult {
  messagesSent: number
  sentMessageIds: string[]
  sentContents: string[]
  lastProcessedSequence: bigint
  sources: SourceItem[]
}

interface PendingMessage {
  content: string
  sources?: SourceItem[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip execute handlers from tools so generateText returns tool calls
 * without auto-executing them. The agent loop executes tools manually
 * to apply trust boundary, extract sources, and record trace steps.
 */
function toDefinitions(tools: Record<string, Tool<any, any>>): Record<string, Tool<any, any>> {
  const defs: Record<string, Tool<any, any>> = {}
  for (const [name, t] of Object.entries(tools)) {
    const { execute: _, ...def } = t as Tool<any, any> & { execute?: unknown }
    defs[name] = def
  }
  return defs
}

async function callToolExecute(tool: Tool<any, any>, args: unknown, toolCallId: string): Promise<unknown> {
  const t = tool as Tool<any, any> & { execute?: (args: unknown, opts: unknown) => Promise<unknown> }
  if (!t.execute) throw new Error("Tool has no execute handler")
  return t.execute(args, { toolCallId, messages: [] as ModelMessage[] })
}

// ---------------------------------------------------------------------------
// Tool trace config — step-type mapping + trace formatting in one place (INV-43)
// ---------------------------------------------------------------------------

interface ToolTraceConfig {
  stepType: AgentStepType
  formatTrace(args: Record<string, unknown>, resultStr: string): { content: string; sources?: TraceSource[] }
}

const TOOL_TRACE: Record<string, ToolTraceConfig> = {
  [AgentToolNames.READ_URL]: {
    stepType: "visit_page",
    formatTrace(args, resultStr) {
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
        /* not valid JSON */
      }
      return { content: JSON.stringify({ url }) }
    },
  },
  [AgentToolNames.SEARCH_MESSAGES]: {
    stepType: "workspace_search",
    formatTrace: (args) => ({
      content: JSON.stringify({
        tool: AgentToolNames.SEARCH_MESSAGES,
        query: args.query ?? "",
        stream: args.stream ?? null,
      }),
    }),
  },
  [AgentToolNames.SEARCH_STREAMS]: {
    stepType: "workspace_search",
    formatTrace: (args) => ({
      content: JSON.stringify({ tool: AgentToolNames.SEARCH_STREAMS, query: args.query ?? "" }),
    }),
  },
  [AgentToolNames.SEARCH_USERS]: {
    stepType: "workspace_search",
    formatTrace: (args) => ({
      content: JSON.stringify({ tool: AgentToolNames.SEARCH_USERS, query: args.query ?? "" }),
    }),
  },
  [AgentToolNames.GET_STREAM_MESSAGES]: {
    stepType: "workspace_search",
    formatTrace: (args) => ({
      content: JSON.stringify({ tool: AgentToolNames.GET_STREAM_MESSAGES, stream: args.stream ?? null }),
    }),
  },
}

function getToolTrace(
  toolName: string,
  args: Record<string, unknown>,
  resultStr: string
): { stepType: AgentStepType; content: string; sources?: TraceSource[] } {
  const config = TOOL_TRACE[toolName]
  if (config) {
    const { content, sources } = config.formatTrace(args, resultStr)
    return { stepType: config.stepType, content, sources }
  }
  return { stepType: "tool_call", content: JSON.stringify({ tool: toolName, args }) }
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

interface ToolExecContext {
  tools: Record<string, Tool<any, any>>
  callbacks: AgentLoopCallbacks
  sources: SourceItem[]
  retrievedContext: string | null
}

interface ToolExecResult {
  resultParts: ToolResultPart[]
  extraMessages: ModelMessage[]
  pendingMessages: PendingMessage[]
  sources: SourceItem[]
  retrievedContext: string | null
}

async function executeToolCalls(
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>,
  ctx: ToolExecContext
): Promise<ToolExecResult> {
  const resultParts: ToolResultPart[] = []
  const extraMessages: ModelMessage[] = []
  const pendingMessages: PendingMessage[] = []
  let { sources, retrievedContext } = ctx

  // Order: web_search first (collect sources), then others, then send_message (staged)
  const webSearchCalls = toolCalls.filter((tc) => tc.toolName === AgentToolNames.WEB_SEARCH)
  const sendMessageCalls = toolCalls.filter((tc) => tc.toolName === AgentToolNames.SEND_MESSAGE)
  const otherCalls = toolCalls.filter(
    (tc) => tc.toolName !== AgentToolNames.WEB_SEARCH && tc.toolName !== AgentToolNames.SEND_MESSAGE
  )

  for (const tc of webSearchCalls) {
    await tracer.startActiveSpan(`tool:${tc.toolName}`, async (toolSpan) => {
      toolSpan.setAttribute("input.value", JSON.stringify(tc.input))
      const startTime = Date.now()
      try {
        const rawResult = await callToolExecute(ctx.tools[tc.toolName], tc.input, tc.toolCallId)
        const durationMs = Date.now() - startTime
        const resultStr = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult)

        const webSources = extractSourcesFromWebSearch(resultStr)
        sources = mergeSourceItems(sources, webSources)

        await ctx.callbacks.recordStep({
          stepType: "web_search",
          content: (tc.input as { query?: string }).query,
          durationMs,
          sources: webSources.map((s) => ({ title: s.title, url: s.url, type: "web" as const })),
        })

        resultParts.push(makeToolResult(tc, protectToolOutputText(resultStr)))
        toolSpan.setAttribute("output.value", resultStr)
        toolSpan.setStatus({ code: SpanStatusCode.OK })
      } catch (error) {
        toolSpan.setAttribute("output.value", JSON.stringify({ error: String(error) }))
        await ctx.callbacks.recordStep({
          stepType: "tool_error",
          content: `web_search failed: ${String(error)}`,
          durationMs: Date.now() - startTime,
        })
        resultParts.push(makeToolResult(tc, JSON.stringify({ error: String(error) })))
        toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
      } finally {
        toolSpan.end()
      }
    })
  }

  for (const tc of otherCalls) {
    const tool = ctx.tools[tc.toolName]
    if (!tool || !("execute" in tool)) {
      await ctx.callbacks.recordStep({ stepType: "tool_error", content: `Unknown tool: ${tc.toolName}` })
      resultParts.push(makeToolResult(tc, JSON.stringify({ error: `Unknown tool: ${tc.toolName}` })))
      continue
    }

    await tracer.startActiveSpan(`tool:${tc.toolName}`, async (toolSpan) => {
      toolSpan.setAttribute("input.value", JSON.stringify(tc.input))
      const startTime = Date.now()
      try {
        const rawResult = await callToolExecute(tool, tc.input, tc.toolCallId)
        const durationMs = Date.now() - startTime
        const resultStr = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult)
        toolSpan.setAttribute("output.value", resultStr)

        if (tc.toolName === WORKSPACE_RESEARCH_TOOL) {
          const parsed = parseWorkspaceResearchResult(resultStr)
          if (!parsed) throw new Error("workspace_research returned malformed JSON")

          const workspaceSources = toSourceItems(parsed.sources)
          if (workspaceSources.length > 0) sources = mergeSourceItems(sources, workspaceSources)
          if (parsed.retrievedContext?.trim()) {
            const newContext = parsed.retrievedContext.trim()
            retrievedContext = retrievedContext ? `${retrievedContext}\n\n${newContext}` : newContext
          }

          await ctx.callbacks.recordStep({
            stepType: "workspace_search",
            content: JSON.stringify({
              memoCount: parsed.memoCount,
              messageCount: parsed.messageCount,
              attachmentCount: parsed.attachmentCount,
            }),
            durationMs,
            sources: workspaceSources.map((s) => ({
              type: "workspace" as const,
              title: s.title,
              url: s.url,
              snippet: s.snippet,
            })),
          })

          resultParts.push(
            makeToolResult(
              tc,
              protectToolOutputText(
                JSON.stringify({
                  status: "ok",
                  contextAdded: Boolean(parsed.retrievedContext?.trim()),
                  sourceCount: workspaceSources.length,
                  memoCount: parsed.memoCount,
                  messageCount: parsed.messageCount,
                  attachmentCount: parsed.attachmentCount,
                })
              )
            )
          )
          toolSpan.setStatus({ code: SpanStatusCode.OK })
          return
        }

        if (isMultimodalToolResult(rawResult)) {
          const textContent = rawResult.content
            .filter((block: { type: string }): block is { type: "text"; text: string } => block.type === "text")
            .map((block: { text: string }) => block.text)
            .join("\n")

          await ctx.callbacks.recordStep({
            stepType: TOOL_TRACE[tc.toolName]?.stepType ?? "tool_call",
            content: textContent,
            durationMs,
          })

          resultParts.push(makeToolResult(tc, protectToolOutputText(textContent)))

          const imageBlocks = rawResult.content.filter(
            (block: { type: string }): block is { type: "image_url"; image_url: { url: string } } =>
              block.type === "image_url"
          )
          if (imageBlocks.length > 0) {
            extraMessages.push({
              role: "user",
              content: imageBlocks.map((block: { image_url: { url: string } }) => ({
                type: "image" as const,
                image: block.image_url.url,
              })),
            })
          }
        } else {
          const trace = getToolTrace(tc.toolName, tc.input as Record<string, unknown>, resultStr)
          await ctx.callbacks.recordStep({
            stepType: trace.stepType,
            content: trace.content,
            sources: trace.sources,
            durationMs,
          })
          resultParts.push(makeToolResult(tc, protectToolOutputText(resultStr)))
        }
        toolSpan.setStatus({ code: SpanStatusCode.OK })
      } catch (error) {
        toolSpan.setAttribute("output.value", JSON.stringify({ error: String(error) }))
        await ctx.callbacks.recordStep({
          stepType: "tool_error",
          content: `${tc.toolName} failed: ${String(error)}`,
          durationMs: Date.now() - startTime,
        })
        resultParts.push(makeToolResult(tc, JSON.stringify({ error: String(error) })))
        toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
      } finally {
        toolSpan.end()
      }
    })
  }

  // Stage send_message calls (prep-then-send)
  for (const tc of sendMessageCalls) {
    pendingMessages.push({
      content: (tc.input as { content: string }).content,
      sources: sources.length > 0 ? [...sources] : undefined,
    })
    resultParts.push(
      makeToolResult(
        tc,
        JSON.stringify({ status: "pending", message: "Message staged. Will be sent after checking for new context." })
      )
    )
  }

  return { resultParts, extraMessages, pendingMessages, sources, retrievedContext }
}

function makeToolResult(tc: { toolCallId: string; toolName: string }, value: string): ToolResultPart {
  return {
    type: "tool-result",
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    output: { type: "text", value },
  }
}

// ---------------------------------------------------------------------------
// New message handling
// ---------------------------------------------------------------------------

async function injectNewMessages(
  newMessages: NewMessageInfo[],
  state: { lastProcessedSequence: bigint; sessionId: string },
  callbacks: AgentLoopCallbacks
): Promise<{ maxSequence: bigint; userMessages: ModelMessage[] }> {
  await callbacks.awaitAttachmentProcessing(newMessages.map((m) => m.messageId))

  const maxSequence = newMessages.reduce((max, m) => (m.sequence > max ? m.sequence : max), state.lastProcessedSequence)
  await callbacks.updateLastSeenSequence(state.sessionId, maxSequence)

  await callbacks.recordStep({
    stepType: "context_received",
    content: JSON.stringify({
      messages: newMessages.map((m) => ({
        messageId: m.messageId,
        authorName: m.authorName,
        authorType: m.authorType,
        createdAt: m.createdAt,
        content: m.content.slice(0, 300),
      })),
    }),
  })

  return {
    maxSequence,
    userMessages: newMessages.map((m) => ({ role: "user" as const, content: m.content })),
  }
}

// ---------------------------------------------------------------------------
// Response extraction & commit
// ---------------------------------------------------------------------------

/** Extract usable text from a generateText result (assistant content). */
function extractAssistantText(result: { text: string; response: { messages: ModelMessage[] } }): string | undefined {
  if (result.text.trim()) return result.text.trim()

  const assistantMsg = result.response.messages[0]
  if (!assistantMsg || assistantMsg.role !== "assistant") return undefined

  if (typeof assistantMsg.content === "string") return assistantMsg.content.trim() || undefined
  if (Array.isArray(assistantMsg.content)) {
    const text = (assistantMsg.content as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("")
    return text.trim() || undefined
  }
  return undefined
}

/** Commit a message through the callback and record the trace step. */
async function commitMessage(
  callbacks: AgentLoopCallbacks,
  pending: { content: string; sources: SourceItem[] },
  sent: { ids: string[]; contents: string[] }
): Promise<{ count: number }> {
  const sendResult = await callbacks.sendMessage({
    content: pending.content,
    sources: pending.sources.length > 0 ? pending.sources : undefined,
  })
  sent.ids.push(sendResult.messageId)
  sent.contents.push(pending.content)
  await callbacks.recordStep({
    stepType: "message_sent",
    content: pending.content,
    messageId: sendResult.messageId,
    sources:
      pending.sources.length > 0
        ? pending.sources.map((s) => ({
            type: (s.type ?? "web") as TraceSource["type"],
            title: s.title,
            url: s.url,
            snippet: s.snippet,
          }))
        : undefined,
  })
  return { count: 1 }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export async function runAgentLoop(input: AgentLoopInput, callbacks: AgentLoopCallbacks): Promise<AgentLoopResult> {
  return tracer.startActiveSpan(
    "companion-session",
    {
      attributes: {
        "langfuse.session.id": input.sessionId,
        "session.id": input.sessionId,
        "stream.id": input.streamId,
        "persona.id": input.personaId,
        ...(input.telemetry?.metadata ?? {}),
      },
    },
    async (rootSpan) => {
      const lastUserMsg = [...input.messages].reverse().find((m) => m.role === "user")
      const inputSummary = lastUserMsg
        ? typeof lastUserMsg.content === "string"
          ? lastUserMsg.content
          : JSON.stringify(lastUserMsg.content)
        : undefined
      if (inputSummary) {
        rootSpan.setAttribute("langfuse.observation.input", inputSummary)
      }

      try {
        const result = await runLoop(input, callbacks)
        rootSpan.setAttributes({
          "session.messages_sent": result.messagesSent,
          "session.source_count": result.sources.length,
          "langfuse.observation.output": result.sentContents.at(-1) ?? "",
        })
        rootSpan.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        rootSpan.setAttributes({
          "langfuse.observation.output": JSON.stringify({ error: String(error) }),
        })
        rootSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(error),
        })
        throw error
      } finally {
        rootSpan.end()
      }
    }
  )
}

async function runLoop(input: AgentLoopInput, callbacks: AgentLoopCallbacks): Promise<AgentLoopResult> {
  const { model, systemPrompt, tools, streamId, sessionId, personaId, telemetry } = input
  let lastProcessedSequence = input.lastProcessedSequence
  const conversation: ModelMessage[] = [...input.messages]
  const toolDefinitions = toDefinitions(tools)
  const sent = { ids: [] as string[], contents: [] as string[] }
  let messagesSent = 0
  let sources: SourceItem[] = []
  let retrievedContext: string | null = null
  let lastAssistantText: string | undefined
  let hasTextReconsidered = false

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const fullSystemPrompt = retrievedContext ? `${systemPrompt}\n\n${retrievedContext}` : systemPrompt
    const truncatedMessages = truncateMessages(conversation, MAX_MESSAGE_CHARS)

    const startTime = Date.now()
    const result = await input.ai.generateTextWithTools({
      model,
      system: fullSystemPrompt,
      messages: truncatedMessages,
      tools: toolDefinitions,
      telemetry,
    })
    const durationMs = Date.now() - startTime

    // Record thinking step
    if (result.text.trim() || result.toolCalls.length > 0) {
      const thinkingContent = result.text.trim()
        ? result.text
        : JSON.stringify({ toolPlan: result.toolCalls.map((tc) => tc.toolName) })
      await callbacks.recordStep({ stepType: "thinking", content: thinkingContent, durationMs })
    }

    // Add assistant message to conversation history
    const assistantMsg = result.response.messages[0]
    if (assistantMsg) conversation.push(assistantMsg)

    // ── Text-only response (no tool calls) ──
    // Model wrote its answer as plain text instead of calling send_message.
    // This is normal — accept the text as the response.
    if (result.toolCalls.length === 0) {
      const currentText = extractAssistantText(result)
      if (currentText) lastAssistantText = currentText

      // Check for new messages that arrived during processing
      const newMessages = await callbacks.checkNewMessages(streamId, lastProcessedSequence, personaId)
      if (newMessages.length > 0) {
        const { maxSequence, userMessages } = await injectNewMessages(
          newMessages,
          { lastProcessedSequence, sessionId },
          callbacks
        )
        lastProcessedSequence = maxSequence
        conversation.push(...userMessages)

        // New context arrived — reconsider once with the draft + new messages
        if (!hasTextReconsidered && lastAssistantText) {
          hasTextReconsidered = true
          conversation.push({
            role: "system",
            content:
              `[New context arrived while you were responding]\n\n` +
              `Your draft response was:\n"${lastAssistantText}"\n\n` +
              `Please incorporate the new messages and respond.`,
          })
          continue
        }
      }

      // Commit the best text we have
      if (lastAssistantText) {
        const committed = await commitMessage(callbacks, { content: lastAssistantText, sources }, sent)
        messagesSent += committed.count
      }
      break
    }

    // ── Tool calls present ──

    // Execute tools
    const execResult = await executeToolCalls(
      result.toolCalls.map((tc) => ({ toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })),
      { tools, callbacks, sources, retrievedContext }
    )
    sources = execResult.sources
    retrievedContext = execResult.retrievedContext

    // Add tool results and extra messages to conversation
    if (execResult.resultParts.length > 0) {
      conversation.push({ role: "tool", content: execResult.resultParts })
    }
    conversation.push(...execResult.extraMessages)

    // --- Finalize or reconsider ---
    const newMessages = await callbacks.checkNewMessages(streamId, lastProcessedSequence, personaId)

    if (execResult.pendingMessages.length > 0) {
      if (newMessages.length === 0) {
        // Commit pending messages — this is the loop's primary exit condition
        for (const pending of execResult.pendingMessages) {
          const committed = await commitMessage(
            callbacks,
            { content: pending.content, sources: pending.sources ?? [] },
            sent
          )
          messagesSent += committed.count
        }
        break
      } else {
        // Reconsider: new messages arrived while response was pending
        const { maxSequence, userMessages } = await injectNewMessages(
          newMessages,
          { lastProcessedSequence, sessionId },
          callbacks
        )
        lastProcessedSequence = maxSequence

        const pendingContents = execResult.pendingMessages.map((p) => p.content).join("\n---\n")
        await callbacks.recordStep({
          stepType: "reconsidering",
          content: JSON.stringify({
            draftResponse: pendingContents,
            newMessages: newMessages.map((m) => ({
              messageId: m.messageId,
              authorName: m.authorName,
              authorType: m.authorType,
              createdAt: m.createdAt,
              content: m.content.slice(0, 300),
            })),
          }),
        })

        conversation.push(...userMessages)
        conversation.push({
          role: "system",
          content:
            `[New context arrived while you were responding]\n\n` +
            `Your draft response${execResult.pendingMessages.length > 1 ? "s were" : " was"}:\n"${pendingContents}"\n\n` +
            `Please respond to all messages, incorporating the new context. ` +
            `You may send the same response${execResult.pendingMessages.length > 1 ? "s" : ""} if still appropriate, or revise based on the new information.`,
        })
      }
    } else if (newMessages.length > 0) {
      // No pending messages but new context arrived
      const { maxSequence, userMessages } = await injectNewMessages(
        newMessages,
        { lastProcessedSequence, sessionId },
        callbacks
      )
      lastProcessedSequence = maxSequence
      conversation.push(...userMessages)
    }
  }

  if (messagesSent === 0) {
    logger.error(
      { sessionId, streamId, iterations: MAX_ITERATIONS },
      "Agent loop exhausted iterations without sending a message"
    )
    throw new Error("Agent loop completed without sending a message")
  }

  return { messagesSent, sentMessageIds: sent.ids, sentContents: sent.contents, lastProcessedSequence, sources }
}
