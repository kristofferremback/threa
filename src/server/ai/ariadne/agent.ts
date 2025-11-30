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
import type { SearchScope } from "../../services/search-service"

export interface ConversationMessage {
  role: "user" | "assistant"
  name: string
  content: string
}

export interface StreamContext {
  topic?: string
  description?: string
  streamName?: string
  members: Array<{ name: string; email: string }>
  parentStream?: {
    name: string
    topic?: string
    members: Array<{ name: string; email: string }>
  }
}

export interface AriadneContext {
  workspaceId: string
  streamId: string
  mentionedBy: string
  mentionedByName?: string
  mode?: AriadneMode
  /**
   * Stream type and visibility for determining search scope.
   * - thinking_space: Full user access (scope: user)
   * - private channel/DM: Current stream + public (scope: private)
   * - public channel: Public only (scope: public)
   */
  streamType?: "channel" | "thread" | "thinking_space"
  streamVisibility?: "public" | "private"
  // For threads/thinking spaces: actual conversation history (back-and-forth)
  conversationHistory?: ConversationMessage[]
  // For channels: background context (recent messages, not a conversation)
  backgroundContext?: string
  // Stream context: members, topic, parent stream info
  streamContext?: StreamContext
}

/**
 * Determine the search scope based on stream type and visibility.
 * This controls what information Ariadne can access.
 */
function determineSearchScope(context: AriadneContext): SearchScope {
  // Thinking spaces: full user access
  if (context.streamType === "thinking_space") {
    return { type: "user" }
  }

  // Private streams (channels or threads): current stream + public
  if (context.streamVisibility === "private") {
    return { type: "private", currentStreamId: context.streamId }
  }

  // Public streams: public only
  return { type: "public" }
}

/**
 * Create an Ariadne agent instance for a specific workspace context.
 * The mentionedBy user ID is used for permission-scoped searches.
 * The search scope is determined by the stream type and visibility.
 */
export function createAriadneAgent(pool: Pool, context: AriadneContext) {
  const scope = determineSearchScope(context)
  const tools = createAriadneTools(pool, {
    workspaceId: context.workspaceId,
    userId: context.mentionedBy,
    currentStreamId: context.streamId,
    scope,
  })
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
    const backgroundContext = config.configurable?.backgroundContext || ""
    const streamContext = config.configurable?.streamContext as StreamContext | undefined

    // Select base prompt based on mode
    let systemPrompt = isThinkingPartner ? THINKING_PARTNER_PROMPT : RETRIEVAL_PROMPT

    if (customInstructions) {
      systemPrompt += `\n\nAdditional context from workspace settings:\n${customInstructions}`
    }

    // Add stream context (members, topic, parent stream)
    if (streamContext) {
      let contextSection = "\n\n## About this conversation"

      if (streamContext.streamName) {
        contextSection += `\nChannel: #${streamContext.streamName}`
      }

      if (streamContext.topic) {
        contextSection += `\nTopic: ${streamContext.topic}`
      }

      if (streamContext.description) {
        contextSection += `\nDescription: ${streamContext.description}`
      }

      if (streamContext.members.length > 0) {
        const memberNames = streamContext.members.slice(0, 10).map((m) => m.name || m.email)
        contextSection += `\nParticipants: ${memberNames.join(", ")}${streamContext.members.length > 10 ? ` and ${streamContext.members.length - 10} others` : ""}`
      }

      if (streamContext.parentStream) {
        contextSection += `\n\nThis is a thread from #${streamContext.parentStream.name}`
        if (streamContext.parentStream.topic) {
          contextSection += ` (topic: ${streamContext.parentStream.topic})`
        }
        if (streamContext.parentStream.members.length > 0) {
          const parentMemberNames = streamContext.parentStream.members.slice(0, 10).map((m) => m.name || m.email)
          contextSection += `\nChannel members: ${parentMemberNames.join(", ")}${streamContext.parentStream.members.length > 10 ? ` and ${streamContext.parentStream.members.length - 10} others` : ""}`
        }
      }

      systemPrompt += contextSection
    }

    // Only add "mentioned by" context in retrieval mode
    if (!isThinkingPartner) {
      systemPrompt += `\n\nYou were mentioned by ${mentionedByName}. Respond directly to them.`
    }

    // Add background context for channel invocations (not conversation history)
    if (backgroundContext) {
      systemPrompt += `\n\n## Recent channel activity (for context only - do NOT respond to these messages, only to the user's question):\n${backgroundContext}`
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

  // Add the current question as the final user message (with name prefix for consistency)
  const questionWithName = context.mentionedByName ? `[${context.mentionedByName}]: ${question}` : question
  messages.push({ role: "user", content: questionWithName })

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
          backgroundContext: context.backgroundContext,
          streamContext: context.streamContext,
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
  const historyLength = context.conversationHistory?.length || 0
  logger.info(
    {
      workspaceId: context.workspaceId,
      streamId: context.streamId,
      mode: context.mode || "retrieval",
      historyMessages: historyLength,
    },
    "Streaming Ariadne response",
  )

  const agent = createAriadneAgent(pool, context)

  // Build message array from conversation history (same as invokeAriadne)
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

  // Add the current question as the final user message (with name prefix for consistency)
  const questionWithName = context.mentionedByName ? `[${context.mentionedByName}]: ${question}` : question
  messages.push({ role: "user", content: questionWithName })

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
      { messages },
      {
        configurable: {
          customInstructions,
          mentionedByName: context.mentionedByName || "someone",
          backgroundContext: context.backgroundContext,
          streamContext: context.streamContext,
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
