import { createReactAgent } from "@langchain/langgraph/prebuilt"
import { ChatAnthropic } from "@langchain/anthropic"
import { BaseMessageLike, AIMessage } from "@langchain/core/messages"
import { RunnableConfig } from "@langchain/core/runnables"
import { MessagesAnnotation } from "@langchain/langgraph"
import { Pool } from "pg"
import { createAriadneTools } from "./tools"
import { RETRIEVAL_PROMPT, THINKING_PARTNER_PROMPT } from "./prompts"
import { logger } from "../../lib/logger"
import type { AriadneMode } from "../../lib/job-queue"
import type { AITraceService, TraceContext, Span } from "../../services/ai-trace-service"

export interface ConversationMessage {
  role: "user" | "assistant"
  name: string
  content: string
}

export interface AriadneContext {
  workspaceId: string
  streamId: string
  mentionedBy: string
  mentionedByName?: string
  mode?: AriadneMode
  conversationHistory?: ConversationMessage[]
}

export interface AriadneTraceOptions {
  traceService?: AITraceService
  context?: TraceContext
  parentSpan?: Span
}

/**
 * Create an Ariadne agent instance for a specific workspace context.
 */
export function createAriadneAgent(pool: Pool, context: AriadneContext) {
  const tools = createAriadneTools(pool, context.workspaceId, context.streamId)
  const isThinkingPartner = context.mode === "thinking_partner"

  const model = new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    temperature: isThinkingPartner ? 0.8 : 0.7,
    maxTokens: isThinkingPartner ? 4096 : 2048,
  })

  const prompt = (state: typeof MessagesAnnotation.State, config: RunnableConfig): BaseMessageLike[] => {
    const customInstructions = config.configurable?.customInstructions || ""
    const mentionedByName = config.configurable?.mentionedByName || "someone"

    let systemPrompt = isThinkingPartner ? THINKING_PARTNER_PROMPT : RETRIEVAL_PROMPT

    if (customInstructions) {
      systemPrompt += `\n\nAdditional context from workspace settings:\n${customInstructions}`
    }

    if (!isThinkingPartner) {
      systemPrompt += `\n\nYou were mentioned by ${mentionedByName}. Respond directly to them.`
    }

    return [{ role: "system", content: systemPrompt }, ...state.messages]
  }

  const agent = createReactAgent({
    llm: model,
    tools,
    prompt,
  })

  return agent
}

/**
 * Invoke Ariadne with a question and context.
 */
export async function invokeAriadne(
  pool: Pool,
  context: AriadneContext,
  question: string,
  customInstructions?: string,
  traceOptions?: AriadneTraceOptions,
): Promise<{
  response: string
  usage: { inputTokens: number; outputTokens: number }
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>
}> {
  const historyLength = context.conversationHistory?.length || 0

  const span = await startSpan(traceOptions, {
    operation: "agent.invoke",
    model: "claude-haiku-4-5-20251001",
    input: question,
    metadata: {
      mode: context.mode || "retrieval",
      historyMessages: historyLength,
      workspaceId: context.workspaceId,
      streamId: context.streamId,
    },
  })

  logger.info(
    {
      workspaceId: context.workspaceId,
      streamId: context.streamId,
      questionLength: question.length,
      mode: context.mode || "retrieval",
      historyMessages: historyLength,
    },
    "Invoking Ariadne",
  )

  const agent = createAriadneAgent(pool, context)

  const messages: Array<{ role: "user" | "assistant"; content: string }> = []

  if (context.conversationHistory && context.conversationHistory.length > 0) {
    for (const msg of context.conversationHistory) {
      const formattedContent = msg.role === "user" ? `[${msg.name}]: ${msg.content}` : msg.content

      messages.push({
        role: msg.role,
        content: formattedContent,
      })
    }
  }

  messages.push({ role: "user", content: question })

  try {
    const result = await agent.invoke(
      { messages },
      {
        configurable: {
          customInstructions,
          mentionedByName: context.mentionedByName || "someone",
        },
      },
    )

    const resultMessages = result.messages
    const lastMessage = resultMessages[resultMessages.length - 1]
    const response = typeof lastMessage.content === "string" ? lastMessage.content : JSON.stringify(lastMessage.content)

    // Extract tool calls from the conversation for tracing
    const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = []
    for (const msg of resultMessages) {
      if (msg instanceof AIMessage && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolCalls.push({ name: tc.name, input: tc.args as Record<string, unknown> })
        }
      }
    }

    // Better token estimation based on all messages
    const totalInputChars = messages.reduce((sum, m) => sum + m.content.length, 0)
    const inputTokens = Math.ceil(totalInputChars / 4)
    const outputTokens = Math.ceil(response.length / 4)

    logger.info({ workspaceId: context.workspaceId, responseLength: response.length, toolCallCount: toolCalls.length }, "Ariadne response generated")

    await endSpan(span, {
      status: "success",
      output: response,
      inputTokens,
      outputTokens,
      metadata: {
        toolCallCount: toolCalls.length,
        toolCalls: toolCalls.map((tc) => tc.name),
        messageCount: resultMessages.length,
      },
    })

    return {
      response,
      usage: { inputTokens, outputTokens },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
  } catch (err) {
    logger.error({ err, context }, "Ariadne invocation failed")

    await endSpan(span, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: err instanceof Error ? err.name : undefined,
    })

    throw err
  }
}

/**
 * Stream Ariadne's response for real-time output.
 */
export async function* streamAriadne(
  pool: Pool,
  context: AriadneContext,
  question: string,
  customInstructions?: string,
  traceOptions?: AriadneTraceOptions,
): AsyncGenerator<{ type: "token" | "tool_call" | "done"; content: string }> {
  const span = await startSpan(traceOptions, {
    operation: "agent.stream",
    model: "claude-haiku-4-5-20251001",
    input: question,
    metadata: {
      mode: context.mode || "retrieval",
      workspaceId: context.workspaceId,
      streamId: context.streamId,
    },
  })

  logger.info({ workspaceId: context.workspaceId, streamId: context.streamId }, "Streaming Ariadne response")

  const agent = createAriadneAgent(pool, context)
  const toolCallsTracked: string[] = []
  let finalResponse = ""

  try {
    const stream = await agent.stream(
      {
        messages: [{ role: "user", content: question }],
      },
      {
        configurable: {
          customInstructions,
          mentionedByName: context.mentionedByName || "someone",
        },
        streamMode: "values",
      },
    )

    let lastMessageCount = 0

    for await (const chunk of stream) {
      const chunkMessages = chunk.messages
      if (chunkMessages.length > lastMessageCount) {
        const newMessage = chunkMessages[chunkMessages.length - 1]

        // Check for tool calls using AIMessage type guard
        if (newMessage instanceof AIMessage && newMessage.tool_calls?.length) {
          for (const toolCall of newMessage.tool_calls) {
            toolCallsTracked.push(toolCall.name)
            yield {
              type: "tool_call",
              content: `Using ${toolCall.name}...`,
            }
          }
        } else if (typeof newMessage.content === "string" && newMessage.content) {
          finalResponse = newMessage.content
          yield {
            type: "token",
            content: newMessage.content,
          }
        }

        lastMessageCount = chunkMessages.length
      }
    }

    await endSpan(span, {
      status: "success",
      output: finalResponse,
      inputTokens: Math.ceil(question.length / 4),
      outputTokens: Math.ceil(finalResponse.length / 4),
      metadata: {
        toolCallCount: toolCallsTracked.length,
        toolCalls: toolCallsTracked,
      },
    })

    yield { type: "done", content: "" }
  } catch (err) {
    logger.error({ err, context }, "Ariadne streaming failed")

    await endSpan(span, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: err instanceof Error ? err.name : undefined,
    })

    throw err
  }
}

// Helper functions for optional tracing

interface SpanStartOptions {
  operation: string
  model: string
  input?: string
  metadata?: Record<string, unknown>
}

interface SpanEndOptions {
  status: "success" | "error"
  output?: string
  inputTokens?: number
  outputTokens?: number
  errorMessage?: string
  errorCode?: string
  metadata?: Record<string, unknown>
}

async function startSpan(
  traceOptions: AriadneTraceOptions | undefined,
  options: SpanStartOptions,
): Promise<Span | null> {
  if (!traceOptions?.traceService || !traceOptions?.context) {
    return null
  }

  if (traceOptions.parentSpan) {
    return traceOptions.parentSpan.child({
      operation: options.operation,
      provider: "langchain",
      model: options.model,
      input: options.input,
      metadata: options.metadata,
    })
  }

  return traceOptions.traceService.startSpan(traceOptions.context, {
    operation: options.operation,
    provider: "langchain",
    model: options.model,
    input: options.input,
    metadata: options.metadata,
  })
}

async function endSpan(span: Span | null, options: SpanEndOptions): Promise<void> {
  if (!span) return

  await span.end({
    status: options.status,
    output: options.output,
    inputTokens: options.inputTokens,
    outputTokens: options.outputTokens,
    errorMessage: options.errorMessage,
    errorCode: options.errorCode,
    metadata: options.metadata,
  })
}
