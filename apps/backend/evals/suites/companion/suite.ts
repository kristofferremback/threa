/**
 * Companion Agent Evaluation Suite
 *
 * Tests the companion agent's response quality across different contexts:
 * - Stream types: scratchpad, channel, thread, dm
 * - Triggers: companion mode, @mention
 * - Message types: greetings, questions, tasks, information sharing
 *
 * ## Usage
 *
 *   # Run all companion tests
 *   bun run eval -- -s companion
 *
 *   # Run specific cases
 *   bun run eval -- -s companion -c scratchpad-companion-greeting-001
 *
 *   # Compare models
 *   bun run eval -- -s companion -m openrouter:anthropic/claude-haiku-4.5,openrouter:openai/gpt-4.1-mini -p 2
 *
 *   # Skip Langfuse recording
 *   bun run eval -- -s companion --no-langfuse
 *
 * ## Case ID Format
 *
 * Case IDs follow the pattern: {stream_type}-{trigger}-{category}-{number}
 * Examples:
 *   - scratchpad-companion-greeting-001
 *   - channel-mention-help-001
 *   - dm-companion-casual-001
 *
 * ## Key Evaluators
 *
 * - should-respond: Did the agent correctly decide to respond?
 * - content-contains: Does response include expected keywords?
 * - content-not-contains: Does response avoid unwanted phrases?
 * - brevity: Is response appropriately concise?
 * - asks-question: Does it ask clarifying questions when needed?
 * - web-search-usage: Did it use web search when expected?
 * - response-quality: LLM-as-judge overall quality
 * - tone: LLM-as-judge tone appropriateness
 */

import type { EvalSuite, EvalContext, EvalCase } from "../../framework/types"
import { companionCases, type CompanionInput, type CompanionExpected } from "./cases"
import type { CompanionOutput, CompanionMessage } from "./types"
import {
  shouldRespondEvaluator,
  contentContainsEvaluator,
  contentNotContainsEvaluator,
  brevityEvaluator,
  asksQuestionEvaluator,
  webSearchUsageEvaluator,
  createResponseQualityEvaluator,
  createToneEvaluator,
  accuracyEvaluator,
  responseDecisionAccuracyEvaluator,
  averageQualityEvaluator,
} from "./evaluators"
import { COMPANION_MODEL_ID, COMPANION_EVAL_MODEL_ID, COMPANION_TEMPERATURES } from "./config"
import {
  createCompanionGraph,
  toLangChainMessages,
  type CompanionGraphCallbacks,
} from "../../../src/agents/companion-graph"
import type { StructuredToolInterface } from "@langchain/core/tools"
import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import { MemorySaver } from "@langchain/langgraph"
import { Researcher, type ResearcherResult } from "../../../src/agents/researcher/researcher"
import { RESEARCHER_MODEL_ID } from "../../../src/agents/researcher/config"
import { EmbeddingService } from "../../../src/services/embedding-service"
import type { Message } from "../../../src/repositories/message-repository"
import { StreamRepository } from "../../../src/repositories/stream-repository"
import { StreamMemberRepository } from "../../../src/repositories/stream-member-repository"
import { ulid } from "ulid"

/**
 * Build system prompt for eval context.
 * Simplified version of the production buildSystemPrompt.
 */
function buildEvalSystemPrompt(input: CompanionInput): string {
  let prompt = `You are Ariadne, a helpful AI assistant in a workspace collaboration tool.
You help users with questions, provide information, and engage in thoughtful conversation.

Be concise, helpful, and match the tone of the conversation.
When you don't know something, say so honestly.
Don't make up information you don't have.`

  // Add stream context
  switch (input.streamType) {
    case "scratchpad":
      prompt += `

## Context
You are in a personal scratchpad - a private space for notes and thinking.
This is a solo context where you're helping one person.`
      break

    case "channel":
      prompt += `

## Context
You are in a team channel${input.streamContext?.name ? ` called "${input.streamContext.name}"` : ""}.
This is a collaborative space where team members discuss topics.
${input.streamContext?.participants ? `Members: ${input.streamContext.participants.join(", ")}` : ""}`
      break

    case "thread":
      prompt += `

## Context
You are in a thread - a focused discussion branching from a parent conversation.
Stay on topic and build on the existing discussion.`
      break

    case "dm":
      prompt += `

## Context
You are in a direct message conversation.
This is a private, focused conversation.`
      break
  }

  // Add invocation context for mentions
  if (input.trigger === "mention" && input.userName) {
    prompt += `

## Invocation
You were @mentioned by ${input.userName} who wants your assistance.`
  }

  // Add send_message tool instructions
  prompt += `

## Responding
You have a \`send_message\` tool to send messages. Use it when you want to respond.
- Call send_message to send a response
- If you have nothing meaningful to add, don't call send_message
- Be helpful and conversational`

  return prompt
}

/**
 * Create a send_message tool that captures messages.
 */
function createCaptureSendMessageTool(messages: CompanionMessage[]): StructuredToolInterface {
  return new DynamicStructuredTool({
    name: "send_message",
    description: "Send a message to the conversation",
    schema: z.object({
      content: z.string().describe("The message content to send"),
    }),
    func: async ({ content }) => {
      messages.push({ content })
      return JSON.stringify({ status: "sent", messageId: `msg_${Date.now()}` })
    },
  })
}

/**
 * Create a checkpointer for the eval.
 * Uses MemorySaver for simplicity in evals (no persistence needed).
 */
function createCheckpointer(): MemorySaver {
  return new MemorySaver()
}

/**
 * Create a mock Message from eval input for the researcher.
 */
function createMockMessage(
  content: string,
  streamId: string,
  authorId: string,
  authorType: "user" | "persona" = "user"
): Message {
  return {
    id: `msg_${ulid()}`,
    streamId,
    sequence: BigInt(1),
    authorId,
    authorType,
    contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: content }] }] },
    contentMarkdown: content,
    replyCount: 0,
    reactions: {},
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(),
  }
}

/**
 * Convert conversation history to Message array for the researcher.
 */
function historyToMessages(
  history: Array<{ role: "user" | "assistant"; content: string }> | undefined,
  streamId: string,
  userId: string,
  personaId: string
): Message[] {
  if (!history) return []

  return history.map((msg, index) => ({
    id: `msg_${ulid()}_${index}`,
    streamId,
    sequence: BigInt(index + 1),
    authorId: msg.role === "user" ? userId : personaId,
    authorType: msg.role === "user" ? ("user" as const) : ("persona" as const),
    contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: msg.content }] }] },
    contentMarkdown: msg.content,
    replyCount: 0,
    reactions: {},
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(Date.now() - (history.length - index) * 60000), // Stagger timestamps
  }))
}

/**
 * Get model configuration from context, respecting component overrides.
 */
function getModelConfig(
  ctx: EvalContext,
  component: "companion" | "researcher"
): { model: string; temperature?: number } {
  const override = ctx.componentOverrides?.[component]
  const baseModel = ctx.permutation.model
  const baseTemp = ctx.permutation.temperature

  return {
    model: override?.model ?? baseModel,
    temperature: override?.temperature ?? baseTemp,
  }
}

/**
 * Task function that runs the companion graph and captures output.
 *
 * Integrates the full companion system including:
 * - Companion agent (main model)
 * - Researcher (workspace knowledge retrieval)
 *
 * Component overrides supported:
 * - companion: Main agent model
 * - researcher: Researcher model (for deciding when/how to search)
 */
async function runCompanionTask(input: CompanionInput, ctx: EvalContext): Promise<CompanionOutput> {
  // Skip empty messages
  if (!input.message.trim()) {
    return {
      input,
      messages: [],
      responded: false,
    }
  }

  const capturedMessages: CompanionMessage[] = []
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = []

  // Create tools
  const sendMessageTool = createCaptureSendMessageTool(capturedMessages)
  const tools: StructuredToolInterface[] = [sendMessageTool]

  // Get model configuration with component overrides
  const companionConfig = getModelConfig(ctx, "companion")
  const researcherConfig = getModelConfig(ctx, "researcher")

  // Get LangChain model from AI wrapper
  const model = ctx.ai.getLangChainModel(companionConfig.model)

  // Create the companion graph
  const graph = createCompanionGraph(model, tools)

  // Create checkpointer (use simple memory store for evals)
  const checkpointer = createCheckpointer()

  // Compile the graph
  const compiledGraph = graph.compile({ checkpointer })

  // Build messages array
  const conversationHistory = input.conversationHistory || []
  const allMessages = [...conversationHistory, { role: "user" as const, content: input.message }]
  const langchainMessages = toLangChainMessages(allMessages)

  // Build system prompt
  const systemPrompt = buildEvalSystemPrompt(input)

  // Generate IDs for the eval run
  const streamId = `stream_${ulid()}`
  const sessionId = `session_eval_${Date.now()}`
  const personaId = "persona_eval_ariadne"
  const threadId = `eval_${ctx.workspaceId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

  // Create the stream in the database so the researcher can find it
  // Map stream type from eval input to actual stream type
  const dbStreamType = input.streamType === "scratchpad" ? "scratchpad" : input.streamType
  await StreamRepository.insert(ctx.pool, {
    id: streamId,
    workspaceId: ctx.workspaceId,
    type: dbStreamType,
    displayName: input.streamContext?.name ?? `Eval ${input.streamType}`,
    slug: input.streamType === "channel" ? `eval-${ulid().toLowerCase().slice(0, 8)}` : null,
    description: input.streamContext?.description ?? null,
    visibility: "private",
    companionMode: input.trigger === "companion" ? "on" : "off",
    companionPersonaId: input.trigger === "companion" ? personaId : null,
    createdBy: ctx.userId,
  })

  // Add user as stream member so they can access it
  await StreamMemberRepository.insert(ctx.pool, streamId, ctx.userId)

  // Create embedding service for researcher
  const embeddingService = new EmbeddingService({ ai: ctx.ai })

  // Create researcher with pool from eval context
  const researcher = new Researcher({
    pool: ctx.pool,
    ai: ctx.ai,
    embeddingService,
  })

  // Create mock messages for researcher
  const triggerMessage = createMockMessage(input.message, streamId, ctx.userId)
  const historyMessages = historyToMessages(conversationHistory, streamId, ctx.userId, personaId)

  // Create runResearcher callback
  const runResearcher = async (
    langchainConfig: import("@langchain/core/runnables").RunnableConfig
  ): Promise<ResearcherResult> => {
    return researcher.research({
      workspaceId: ctx.workspaceId,
      streamId,
      triggerMessage,
      conversationHistory: historyMessages,
      invokingUserId: ctx.userId,
      langchainConfig,
    })
  }

  // Create graph callbacks with researcher
  const graphCallbacks: CompanionGraphCallbacks = {
    checkNewMessages: async () => [],
    updateLastSeenSequence: async () => {},
    sendMessageWithSources: async ({ content, sources }) => {
      capturedMessages.push({ content, sources })
      return { messageId: `msg_${Date.now()}`, content }
    },
    runResearcher,
  }

  try {
    // Invoke the graph
    const result = await compiledGraph.invoke(
      {
        messages: langchainMessages,
        systemPrompt,
        streamId,
        sessionId,
        personaId,
        lastProcessedSequence: BigInt(0),
        finalResponse: null,
        iteration: 0,
        messagesSent: 0,
        hasNewMessages: false,
        sources: [],
        retrievedContext: null,
      },
      {
        runName: "companion-eval",
        configurable: {
          thread_id: threadId,
          callbacks: graphCallbacks,
        },
      }
    )

    // Record usage
    ctx.usage.recordUsage({
      promptTokens: 0, // Would need to track from model callbacks
      completionTokens: 0,
    })

    return {
      input,
      messages: capturedMessages,
      responded: capturedMessages.length > 0,
      toolCalls,
    }
  } catch (error) {
    return {
      input,
      messages: [],
      responded: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Companion Agent Evaluation Suite
 */
export const companionSuite: EvalSuite<CompanionInput, CompanionOutput, CompanionExpected> = {
  name: "companion",
  description: "Evaluates companion agent response quality across different contexts",

  cases: companionCases,

  task: runCompanionTask,

  evaluators: [
    shouldRespondEvaluator,
    contentContainsEvaluator,
    contentNotContainsEvaluator,
    brevityEvaluator,
    asksQuestionEvaluator,
    webSearchUsageEvaluator,
    createResponseQualityEvaluator(),
    createToneEvaluator(),
  ],

  runEvaluators: [accuracyEvaluator, responseDecisionAccuracyEvaluator, averageQualityEvaluator],

  defaultPermutations: [
    {
      model: COMPANION_EVAL_MODEL_ID,
      temperature: COMPANION_TEMPERATURES.response,
    },
  ],
}

export default companionSuite
