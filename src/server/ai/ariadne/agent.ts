import { createReactAgent } from "@langchain/langgraph/prebuilt"
import { ChatAnthropic } from "@langchain/anthropic"
import { BaseMessageLike } from "@langchain/core/messages"
import { RunnableConfig } from "@langchain/core/runnables"
import { MessagesAnnotation } from "@langchain/langgraph"
import { Pool } from "pg"
import { CallbackHandler } from "@langfuse/langchain"
import { createAriadneTools } from "./tools"
import { RETRIEVAL_PROMPT, THINKING_PARTNER_PROMPT } from "./prompts"
import { logger } from "../../lib/logger"
import { isLangfuseEnabled } from "../../lib/langfuse"
import type { AriadneMode } from "../../lib/job-queue"

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

/**
 * Create an Ariadne agent instance for a specific workspace context.
 */
export function createAriadneAgent(pool: Pool, context: AriadneContext) {
  const tools = createAriadneTools(pool, context.workspaceId, context.streamId)
  const isThinkingPartner = context.mode === "thinking_partner"

  const model = new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    temperature: isThinkingPartner ? 0.8 : 0.7, // Slightly higher temperature for thinking partner
    maxTokens: isThinkingPartner ? 4096 : 2048, // Allow longer responses in thinking mode
  })

  // Dynamic prompt that includes context
  const prompt = (state: typeof MessagesAnnotation.State, config: RunnableConfig): BaseMessageLike[] => {
    const customInstructions = config.configurable?.customInstructions || ""
    const mentionedByName = config.configurable?.mentionedByName || "someone"

    // Select base prompt based on mode
    let systemPrompt = isThinkingPartner ? THINKING_PARTNER_PROMPT : RETRIEVAL_PROMPT

    if (customInstructions) {
      systemPrompt += `\n\nAdditional context from workspace settings:\n${customInstructions}`
    }

    // Only add "mentioned by" context in retrieval mode
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
): Promise<{
  response: string
  usage: { inputTokens: number; outputTokens: number }
}> {
  const historyLength = context.conversationHistory?.length || 0
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

  // Build message array from conversation history
  const messages: Array<{ role: "user" | "assistant"; content: string }> = []

  // Add conversation history if available
  if (context.conversationHistory && context.conversationHistory.length > 0) {
    for (const msg of context.conversationHistory) {
      // Format message with name prefix for context
      const formattedContent = msg.role === "user" ? `[${msg.name}]: ${msg.content}` : msg.content

      messages.push({
        role: msg.role,
        content: formattedContent,
      })
    }
  }

  // Add the current question as the final user message
  messages.push({ role: "user", content: question })

  try {
    // Create Langfuse callback handler for tracing if enabled
    const callbacks: CallbackHandler[] = []
    if (isLangfuseEnabled()) {
      callbacks.push(
        new CallbackHandler({
          sessionId: context.streamId,
          userId: context.mentionedBy,
          tags: ["ariadne", context.mode || "retrieval"],
          traceMetadata: {
            workspaceId: context.workspaceId,
            streamId: context.streamId,
          },
        }),
      )
    }

    const result = await agent.invoke(
      { messages },
      {
        configurable: {
          customInstructions,
          mentionedByName: context.mentionedByName || "someone",
        },
        callbacks,
      },
    )

    // Extract the final response
    const resultMessages = result.messages
    const lastMessage = resultMessages[resultMessages.length - 1]
    const response = typeof lastMessage.content === "string" ? lastMessage.content : JSON.stringify(lastMessage.content)

    // Estimate token usage (LangGraph doesn't expose this directly from Anthropic)
    // We'll track actual usage in the worker via the usage service
    const inputTokens = Math.ceil(question.length / 4)
    const outputTokens = Math.ceil(response.length / 4)

    logger.info({ workspaceId: context.workspaceId, responseLength: response.length }, "Ariadne response generated")

    return {
      response,
      usage: { inputTokens, outputTokens },
    }
  } catch (err) {
    logger.error({ err, context }, "Ariadne invocation failed")
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
): AsyncGenerator<{ type: "token" | "tool_call" | "done"; content: string }> {
  logger.info({ workspaceId: context.workspaceId, streamId: context.streamId }, "Streaming Ariadne response")

  const agent = createAriadneAgent(pool, context)

  try {
    // Create Langfuse callback handler for tracing if enabled
    const callbacks: CallbackHandler[] = []
    if (isLangfuseEnabled()) {
      callbacks.push(
        new CallbackHandler({
          sessionId: context.streamId,
          userId: context.mentionedBy,
          tags: ["ariadne", context.mode || "retrieval", "streaming"],
          traceMetadata: {
            workspaceId: context.workspaceId,
            streamId: context.streamId,
          },
        }),
      )
    }

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
        callbacks,
      },
    )

    let lastMessageCount = 0

    for await (const chunk of stream) {
      const messages = chunk.messages
      if (messages.length > lastMessageCount) {
        const newMessage = messages[messages.length - 1]

        if (newMessage.tool_calls?.length) {
          for (const toolCall of newMessage.tool_calls) {
            yield {
              type: "tool_call",
              content: `Using ${toolCall.name}...`,
            }
          }
        } else if (typeof newMessage.content === "string" && newMessage.content) {
          yield {
            type: "token",
            content: newMessage.content,
          }
        }

        lastMessageCount = messages.length
      }
    }

    yield { type: "done", content: "" }
  } catch (err) {
    logger.error({ err, context }, "Ariadne streaming failed")
    throw err
  }
}
