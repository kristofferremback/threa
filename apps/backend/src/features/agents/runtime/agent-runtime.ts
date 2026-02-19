import type { LanguageModel, ModelMessage, Tool, ToolResultPart } from "ai"
import type { SourceItem, TraceSource } from "@threa/types"
import { AgentToolNames } from "@threa/types"
import type { AI } from "../../../lib/ai/ai"
import { logger } from "../../../lib/logger"
import { protectToolOutputText } from "../tool-trust-boundary"
import { MAX_MESSAGE_CHARS, truncateMessages } from "../companion/truncation"
import { createKeepResponseTool } from "../tools/keep-response-tool"
import { createSendMessageTool } from "../tools/send-message-tool"
import type { AgentTool, AgentToolResult } from "./agent-tool"
import { toVercelToolDefs } from "./agent-tool"
import type { AgentEvent, NewMessageInfo } from "./agent-events"
import type { AgentObserver } from "./agent-observer"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITERATIONS = 20
const KEEP_RESPONSE_TOOL_NAME = "keep_response"

export interface NewMessageAwareness {
  check: (streamId: string, sinceSequence: bigint, excludeAuthorId: string) => Promise<NewMessageInfo[]>
  updateSequence: (sessionId: string, sequence: bigint) => Promise<void>
  awaitAttachments: (messageIds: string[]) => Promise<void>
  streamId: string
  sessionId: string
  personaId: string
  lastProcessedSequence: bigint
}

export interface AgentRuntimeConfig {
  ai: AI
  model: LanguageModel
  systemPrompt: string
  messages: ModelMessage[]
  tools: AgentTool[]
  maxIterations?: number
  observers?: AgentObserver[]
  telemetry?: { functionId: string; metadata?: Record<string, string | number | boolean> }

  /** Terminal action — sends a message to the conversation */
  sendMessage: (input: {
    content: string
    sources?: SourceItem[]
  }) => Promise<{ messageId: string; operation?: "created" | "edited" }>

  /** Optional new-message awareness (companion uses this, simpler agents don't) */
  newMessages?: NewMessageAwareness

  /** Optional cancellation hook (e.g., when session was externally deleted/superseded). */
  shouldAbort?: () => Promise<string | null>

  /**
   * Allow sessions to complete without sending a new message.
   * Used for supersede reruns where retaining prior responses is a valid outcome.
   */
  allowNoMessageOutput?: boolean

  /**
   * Optional validation hook for candidate final responses.
   * Return a reason string to reject and force another iteration.
   */
  validateFinalResponse?: (content: string) => string | null
}

export interface AgentRuntimeResult {
  messagesSent: number
  sentMessageIds: string[]
  sentContents: string[]
  lastProcessedSequence: bigint
  sources: SourceItem[]
  noMessageReason?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PendingMessage {
  content: string
  sources?: SourceItem[]
}

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

function mergeSourceItems(existing: SourceItem[], incoming: SourceItem[]): SourceItem[] {
  if (incoming.length === 0) return existing
  const merged = [...existing]
  const seen = new Set(merged.map((s) => `${s.url}|${s.title}`))
  for (const s of incoming) {
    const key = `${s.url}|${s.title}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(s)
  }
  return merged
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
// AgentRuntime
// ---------------------------------------------------------------------------

export class AgentRuntime {
  private readonly maxIterations: number
  private readonly observers: AgentObserver[]
  private readonly toolMap: Map<string, AgentTool>
  private readonly toolDefs: Record<string, Tool<any, any>>

  constructor(private readonly config: AgentRuntimeConfig) {
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS
    this.observers = config.observers ?? []
    this.toolMap = new Map(config.tools.map((t) => [t.name, t]))
    this.toolDefs = this.buildToolDefs()
  }

  /**
   * Build the complete set of tool definitions the LLM sees.
   * Includes all AgentTool schemas plus send_message (terminal action the runtime intercepts).
   */
  private buildToolDefs(): Record<string, Tool<any, any>> {
    const defs = toVercelToolDefs(this.config.tools)
    defs[AgentToolNames.SEND_MESSAGE] = createSendMessageTool()
    if (this.config.allowNoMessageOutput) {
      defs[KEEP_RESPONSE_TOOL_NAME] = createKeepResponseTool()
    }
    return defs
  }

  async run(): Promise<AgentRuntimeResult> {
    const nm = this.config.newMessages

    // Emit session start
    const inputSummary = this.extractInputSummary()
    await this.emit({ type: "session:start", sessionId: nm?.sessionId ?? "", inputSummary })

    try {
      const result = await this.loop()
      await this.emit({
        type: "session:end",
        messagesSent: result.messagesSent,
        sourceCount: result.sources.length,
        lastContent: result.sentContents.at(-1),
      })
      return result
    } catch (error) {
      await this.emit({ type: "session:error", error: String(error) })
      throw error
    } finally {
      for (const observer of this.observers) {
        try {
          await observer.cleanup?.()
        } catch (err) {
          logger.warn({ err }, "Observer cleanup failed")
        }
      }
    }
  }

  private async loop(): Promise<AgentRuntimeResult> {
    const { ai, model, systemPrompt } = this.config
    const nm = this.config.newMessages

    const conversation: ModelMessage[] = [...this.config.messages]
    const sent = { ids: [] as string[], contents: [] as string[] }
    let messagesSent = 0
    let sources: SourceItem[] = []
    let retrievedContext: string | null = null
    let lastAssistantText: string | undefined
    let hasTextReconsidered = false
    let lastProcessedSequence = nm?.lastProcessedSequence ?? BigInt(0)
    let keptResponseReason: string | null = null
    let responseKeptEmitted = false

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const abortReason = await this.config.shouldAbort?.()
      if (abortReason) {
        throw new Error(`Agent session aborted: ${abortReason}`)
      }

      const fullSystemPrompt = retrievedContext ? `${systemPrompt}\n\n${retrievedContext}` : systemPrompt
      const truncatedMessages = truncateMessages(conversation, MAX_MESSAGE_CHARS)

      const startTime = Date.now()
      const result = await this.wrapWithObserverContext(() =>
        ai.generateTextWithTools({
          model,
          system: fullSystemPrompt,
          messages: truncatedMessages,
          tools: this.toolDefs,
          telemetry: this.config.telemetry,
        })
      )
      const durationMs = Date.now() - startTime

      // Record thinking
      if (result.text.trim() || result.toolCalls.length > 0) {
        const thinkingContent = result.text.trim()
          ? result.text
          : JSON.stringify({ toolPlan: result.toolCalls.map((tc: { toolName: string }) => tc.toolName) })
        await this.emit({ type: "thinking", content: thinkingContent, durationMs })
      }

      // Add assistant message to conversation
      const assistantMsg = result.response.messages[0]
      if (assistantMsg) conversation.push(assistantMsg)

      // ── Text-only response (no tool calls) ──
      if (result.toolCalls.length === 0) {
        const currentText = extractAssistantText(result)
        if (currentText) lastAssistantText = currentText

        if (nm) {
          const newMessages = await nm.check(nm.streamId, lastProcessedSequence, nm.personaId)
          if (newMessages.length > 0) {
            const maxSeq = await this.injectNewMessages(newMessages, lastProcessedSequence, nm, conversation)
            lastProcessedSequence = maxSeq

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
        }

        if (lastAssistantText) {
          const validationError = this.config.validateFinalResponse?.(lastAssistantText) ?? null
          if (validationError) {
            conversation.push({
              role: "system",
              content:
                `[Final response needs revision]\n\n` +
                `${validationError}\n\n` +
                `Your proposed response was:\n"${lastAssistantText}"\n\n` +
                `Please provide a revised final response now.`,
            })
            continue
          }

          const committed = await this.commitMessage({ content: lastAssistantText, sources }, sent)
          messagesSent += committed
        }
        if (!lastAssistantText && this.config.allowNoMessageOutput) {
          conversation.push({
            role: "system",
            content:
              `[Final decision required]\n\n` +
              `You must choose one final action now.\n` +
              `- If previous responses remain correct, call keep_response with a specific reason tied to the edited message.\n` +
              `- If changes are needed, call send_message with the revised response.\n` +
              `Do not return an empty response.`,
          })
          continue
        }
        break
      }

      // ── Tool calls present ──
      const execResult = await this.executeToolCalls(
        result.toolCalls.map((tc: { toolCallId: string; toolName: string; input: unknown }) => ({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
        })),
        sources,
        retrievedContext
      )
      sources = execResult.sources
      retrievedContext = execResult.retrievedContext

      if (execResult.resultParts.length > 0) {
        conversation.push({ role: "tool", content: execResult.resultParts })
      }
      conversation.push(...execResult.extraMessages)

      // --- Finalize or reconsider ---
      if (nm) {
        const newMessages = await nm.check(nm.streamId, lastProcessedSequence, nm.personaId)

        if (execResult.pendingMessages.length > 0) {
          if (newMessages.length === 0) {
            const invalidPending = this.findInvalidPendingMessage(execResult.pendingMessages)
            if (invalidPending) {
              conversation.push({
                role: "system",
                content:
                  `[Final response needs revision]\n\n` +
                  `${invalidPending.reason}\n\n` +
                  `Your proposed response was:\n"${invalidPending.content}"\n\n` +
                  `Please provide a revised final response and call send_message again.`,
              })
              continue
            }

            for (const pending of execResult.pendingMessages) {
              const committed = await this.commitMessage(
                { content: pending.content, sources: pending.sources ?? [] },
                sent
              )
              messagesSent += committed
            }
            break
          } else {
            const maxSeq = await this.injectNewMessages(newMessages, lastProcessedSequence, nm, conversation)
            lastProcessedSequence = maxSeq

            const pendingContents = execResult.pendingMessages.map((p) => p.content).join("\n---\n")
            await this.emit({
              type: "reconsidering",
              draft: pendingContents,
              newMessages,
            })

            conversation.push({
              role: "system",
              content:
                `[New context arrived while you were responding]\n\n` +
                `Your draft response${execResult.pendingMessages.length > 1 ? "s were" : " was"}:\n"${pendingContents}"\n\n` +
                `Please respond to all messages, incorporating the new context. ` +
                `You may send the same response${execResult.pendingMessages.length > 1 ? "s" : ""} if still appropriate, or revise based on the new information.`,
            })
          }
        } else if (execResult.keepResponseReason) {
          if (newMessages.length === 0) {
            keptResponseReason = execResult.keepResponseReason
            await this.emit({
              type: "response:kept",
              reason: keptResponseReason,
            })
            responseKeptEmitted = true
            break
          }

          const maxSeq = await this.injectNewMessages(newMessages, lastProcessedSequence, nm, conversation)
          lastProcessedSequence = maxSeq

          await this.emit({
            type: "reconsidering",
            draft: `[No change decision]\nReason: ${execResult.keepResponseReason}`,
            newMessages,
          })

          conversation.push({
            role: "system",
            content:
              `[New context arrived after you decided to keep the existing response]\n\n` +
              `Your keep-response reason was:\n"${execResult.keepResponseReason}"\n\n` +
              `Please reconsider. If the previous response is still correct, call keep_response again with an updated reason. ` +
              `If changes are needed, call send_message with the updated response.`,
          })
        } else if (newMessages.length > 0) {
          const maxSeq = await this.injectNewMessages(newMessages, lastProcessedSequence, nm, conversation)
          lastProcessedSequence = maxSeq
        }
      } else {
        // No new-message awareness — commit pending messages immediately
        if (execResult.pendingMessages.length > 0) {
          const invalidPending = this.findInvalidPendingMessage(execResult.pendingMessages)
          if (invalidPending) {
            conversation.push({
              role: "system",
              content:
                `[Final response needs revision]\n\n` +
                `${invalidPending.reason}\n\n` +
                `Your proposed response was:\n"${invalidPending.content}"\n\n` +
                `Please provide a revised final response and call send_message again.`,
            })
            continue
          }

          for (const pending of execResult.pendingMessages) {
            const committed = await this.commitMessage(
              { content: pending.content, sources: pending.sources ?? [] },
              sent
            )
            messagesSent += committed
          }
          break
        }

        if (execResult.keepResponseReason) {
          keptResponseReason = execResult.keepResponseReason
          await this.emit({
            type: "response:kept",
            reason: keptResponseReason,
          })
          responseKeptEmitted = true
          break
        }
      }
    }

    if (sent.ids.length === 0) {
      if (this.config.allowNoMessageOutput) {
        const noMessageReason =
          keptResponseReason ?? "The existing response still fit the updated context, so no message changes were made."

        if (!responseKeptEmitted) {
          await this.emit({
            type: "response:kept",
            reason: noMessageReason,
          })
        }

        logger.info(
          { sessionId: nm?.sessionId, streamId: nm?.streamId, iterations: this.maxIterations },
          "Agent run completed without sending a message"
        )
        return {
          messagesSent,
          sentMessageIds: sent.ids,
          sentContents: sent.contents,
          lastProcessedSequence,
          sources,
          noMessageReason,
        }
      }

      logger.error(
        { sessionId: nm?.sessionId, streamId: nm?.streamId, iterations: this.maxIterations },
        "Agent loop exhausted iterations without sending a message"
      )
      throw new Error("Agent loop completed without sending a message")
    }

    return { messagesSent, sentMessageIds: sent.ids, sentContents: sent.contents, lastProcessedSequence, sources }
  }

  // ---------------------------------------------------------------------------
  // Tool execution
  // ---------------------------------------------------------------------------

  private async executeToolCalls(
    toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>,
    currentSources: SourceItem[],
    currentContext: string | null
  ): Promise<{
    resultParts: ToolResultPart[]
    extraMessages: ModelMessage[]
    pendingMessages: PendingMessage[]
    keepResponseReason: string | null
    sources: SourceItem[]
    retrievedContext: string | null
  }> {
    const resultParts: ToolResultPart[] = []
    const extraMessages: ModelMessage[] = []
    const pendingMessages: PendingMessage[] = []
    let keepResponseReason: string | null = null
    let sources = currentSources
    let retrievedContext = currentContext

    // Order: early-phase tools first, then normal, then send_message (staged)
    const sendMessageCalls = toolCalls.filter((tc) => tc.toolName === AgentToolNames.SEND_MESSAGE)
    const keepResponseCalls = this.config.allowNoMessageOutput
      ? toolCalls.filter((tc) => tc.toolName === KEEP_RESPONSE_TOOL_NAME)
      : []
    const agentToolCalls = toolCalls.filter(
      (tc) =>
        tc.toolName !== AgentToolNames.SEND_MESSAGE &&
        (!this.config.allowNoMessageOutput || tc.toolName !== KEEP_RESPONSE_TOOL_NAME)
    )
    const earlyCalls = agentToolCalls.filter((tc) => this.toolMap.get(tc.toolName)?.config.executionPhase === "early")
    const normalCalls = agentToolCalls.filter((tc) => this.toolMap.get(tc.toolName)?.config.executionPhase !== "early")

    for (const tc of [...earlyCalls, ...normalCalls]) {
      const agentTool = this.toolMap.get(tc.toolName)
      if (!agentTool) {
        await this.emit({
          type: "tool:error",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          error: `Unknown tool: ${tc.toolName}`,
          durationMs: 0,
        })
        resultParts.push(makeToolResult(tc, JSON.stringify({ error: `Unknown tool: ${tc.toolName}` })))
        continue
      }

      await this.emit({ type: "tool:start", toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })
      const startTime = Date.now()

      try {
        const toolResult = await agentTool.config.execute(tc.input as any, { toolCallId: tc.toolCallId })
        const durationMs = Date.now() - startTime

        // Accumulate sources
        if (toolResult.sources && toolResult.sources.length > 0) {
          sources = mergeSourceItems(sources, toolResult.sources)
        }

        // Accumulate system context
        if (toolResult.systemContext?.trim()) {
          const newCtx = toolResult.systemContext.trim()
          retrievedContext = retrievedContext ? `${retrievedContext}\n\n${newCtx}` : newCtx
        }

        // Build trace
        const traceContent = agentTool.config.trace.formatContent(tc.input, toolResult)
        const traceSources = agentTool.config.trace.extractSources?.(tc.input, toolResult)

        await this.emit({
          type: "tool:complete",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
          output: toolResult.output,
          durationMs,
          trace: { stepType: agentTool.config.trace.stepType, content: traceContent, sources: traceSources },
        })

        // Tool result → LLM
        resultParts.push(makeToolResult(tc, protectToolOutputText(toolResult.output)))

        // Multimodal images → injected as user messages
        if (toolResult.multimodal && toolResult.multimodal.length > 0) {
          extraMessages.push({
            role: "user",
            content: toolResult.multimodal.map((img) => ({
              type: "image" as const,
              image: img.url,
            })),
          })
        }
      } catch (error) {
        const durationMs = Date.now() - startTime
        await this.emit({
          type: "tool:error",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          error: String(error),
          durationMs,
        })
        resultParts.push(makeToolResult(tc, JSON.stringify({ error: String(error) })))
      }
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

    for (const tc of keepResponseCalls) {
      const reason = (tc.input as { reason?: unknown }).reason
      keepResponseReason =
        typeof reason === "string" && reason.trim().length > 0
          ? reason.trim()
          : "No substantive changes were needed after reconsidering the updated context."
      resultParts.push(
        makeToolResult(
          tc,
          JSON.stringify({
            status: "accepted",
            message: "Keeping existing response unchanged.",
            reason: keepResponseReason,
          })
        )
      )
    }

    return { resultParts, extraMessages, pendingMessages, keepResponseReason, sources, retrievedContext }
  }

  // ---------------------------------------------------------------------------
  // Message commit
  // ---------------------------------------------------------------------------

  private async commitMessage(
    pending: { content: string; sources: SourceItem[] },
    sent: { ids: string[]; contents: string[] }
  ): Promise<number> {
    const sendResult = await this.config.sendMessage({
      content: pending.content,
      sources: pending.sources.length > 0 ? pending.sources : undefined,
    })
    const operation = sendResult.operation ?? "created"
    sent.ids.push(sendResult.messageId)
    sent.contents.push(pending.content)

    const traceSources =
      pending.sources.length > 0
        ? pending.sources.map((s) => ({
            type: (s.type ?? "web") as TraceSource["type"],
            title: s.title,
            url: s.url,
            snippet: s.snippet,
          }))
        : undefined

    await this.emit({
      type: operation === "edited" ? "message:edited" : "message:sent",
      messageId: sendResult.messageId,
      content: pending.content,
      sources: traceSources,
    })

    return operation === "edited" ? 0 : 1
  }

  private findInvalidPendingMessage(pendingMessages: PendingMessage[]): { content: string; reason: string } | null {
    if (!this.config.validateFinalResponse) return null

    for (const pending of pendingMessages) {
      const reason = this.config.validateFinalResponse(pending.content)
      if (reason) return { content: pending.content, reason }
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // New message injection
  // ---------------------------------------------------------------------------

  private async injectNewMessages(
    newMessages: NewMessageInfo[],
    lastProcessedSequence: bigint,
    nm: NonNullable<AgentRuntimeConfig["newMessages"]>,
    conversation: ModelMessage[]
  ): Promise<bigint> {
    await nm.awaitAttachments(newMessages.map((m) => m.messageId))

    const maxSequence = newMessages.reduce((max, m) => (m.sequence > max ? m.sequence : max), lastProcessedSequence)
    await nm.updateSequence(nm.sessionId, maxSequence)

    await this.emit({ type: "context:received", messages: newMessages })

    const userMessages: ModelMessage[] = newMessages.map((m) => ({ role: "user" as const, content: m.content }))
    conversation.push(...userMessages)

    return maxSequence
  }

  // ---------------------------------------------------------------------------
  // Event emission
  // ---------------------------------------------------------------------------

  private async emit(event: AgentEvent): Promise<void> {
    for (const observer of this.observers) {
      try {
        await observer.handle(event)
      } catch (err) {
        logger.warn({ err, eventType: event.type }, "Observer failed to handle event")
      }
    }
  }

  /**
   * Compose all observers' wrapExecution hooks around an async operation.
   * Allows OTEL observer to set the active span context so that
   * child spans (e.g., from Vercel AI SDK) nest under the root span.
   */
  private async wrapWithObserverContext<T>(fn: () => Promise<T>): Promise<T> {
    let wrapped = fn
    for (const observer of this.observers) {
      if (observer.wrapExecution) {
        const prev = wrapped
        const obs = observer
        wrapped = () => obs.wrapExecution!(prev)
      }
    }
    return wrapped()
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private extractInputSummary(): string | undefined {
    const lastUserMsg = [...this.config.messages].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return undefined
    return typeof lastUserMsg.content === "string" ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)
  }
}
