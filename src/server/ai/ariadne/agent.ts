import { createReactAgent } from "@langchain/langgraph/prebuilt"
import { ChatAnthropic } from "@langchain/anthropic"
import { BaseMessageLike } from "@langchain/core/messages"
import { RunnableConfig } from "@langchain/core/runnables"
import { MessagesAnnotation } from "@langchain/langgraph"
import { Pool } from "pg"
import { createAriadneTools } from "./tools"
import { RETRIEVAL_PROMPT, THINKING_PARTNER_PROMPT } from "./prompts"
import { logger } from "../../lib/logger"
import type { AriadneMode } from "../../lib/job-queue"

export interface AriadneContext {
  workspaceId: string
  streamId: string
  mentionedBy: string
  mentionedByName?: string
  mode?: AriadneMode
}

/**
 * Create an Ariadne agent instance for a specific workspace context.
 */
export function createAriadneAgent(pool: Pool, context: AriadneContext) {
  const tools = createAriadneTools(pool, context.workspaceId, context.streamId)
  const isThinkingPartner = context.mode === "thinking_partner"

  const model = new ChatAnthropic({
    model: "claude-sonnet-4-5-20250929",
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
  logger.info(
    { workspaceId: context.workspaceId, streamId: context.streamId, questionLength: question.length, mode: context.mode || "retrieval" },
    "Invoking Ariadne",
  )

  const agent = createAriadneAgent(pool, context)

  try {
    const result = await agent.invoke(
      {
        messages: [{ role: "user", content: question }],
      },
      {
        configurable: {
          customInstructions,
          mentionedByName: context.mentionedByName || "someone",
        },
      },
    )

    // Extract the final response
    const messages = result.messages
    const lastMessage = messages[messages.length - 1]
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
