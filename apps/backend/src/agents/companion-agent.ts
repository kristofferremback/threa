import { generateText, type CoreMessage } from "ai"
import type { PoolClient } from "pg"
import type { LanguageModel } from "ai"
import type { Message } from "../repositories/message-repository"
import type { Stream } from "../repositories/stream-repository"
import {
  AgentSessionRepository,
  StepTypes,
  type AgentSession,
} from "../repositories/agent-session-repository"
import { stepId } from "../lib/id"
import { logger } from "../lib/logger"

/**
 * Context provided to the companion agent for responding.
 */
export interface CompanionContext {
  session: AgentSession
  stream: Stream
  recentMessages: Message[]
  personaName: string
  systemPrompt: string
}

/**
 * Result from running the companion agent.
 */
export interface CompanionResult {
  response: string
  tokensUsed: number
  stepCount: number
}

/**
 * Builds the system prompt for the companion agent.
 */
function buildSystemPrompt(context: CompanionContext): string {
  const { personaName, systemPrompt, stream } = context

  let prompt = systemPrompt || `You are ${personaName}, an AI companion in a chat application.`

  prompt += `\n\nYou are currently in a ${stream.type}`
  if (stream.displayName) {
    prompt += ` called "${stream.displayName}"`
  }
  if (stream.description) {
    prompt += `: ${stream.description}`
  }
  prompt += "."

  prompt += `\n\nBe helpful, concise, and conversational.`

  return prompt
}

/**
 * Builds the message history for the agent.
 */
function buildMessages(context: CompanionContext): CoreMessage[] {
  const messages: CoreMessage[] = []

  // Add recent conversation history
  for (const msg of context.recentMessages) {
    messages.push({
      role: msg.authorType === "user" ? "user" : "assistant",
      content: msg.content,
    })
  }

  return messages
}

/**
 * Run the companion agent to generate a response.
 *
 * For now, this is a simple single-turn generation without tools.
 * Tools and multi-turn can be added once the basic flow is working.
 */
export async function runCompanionAgent(
  client: PoolClient,
  model: LanguageModel,
  context: CompanionContext,
): Promise<CompanionResult> {
  const { session } = context
  let stepNumber = session.currentStep

  const systemPrompt = buildSystemPrompt(context)
  const messages = buildMessages(context)

  logger.debug(
    { sessionId: session.id, messageCount: messages.length },
    "Running companion agent",
  )

  // Record thinking step
  stepNumber++
  await AgentSessionRepository.insertStep(client, {
    id: stepId(),
    sessionId: session.id,
    stepNumber,
    stepType: StepTypes.THINKING,
    content: { messageCount: messages.length },
  })

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    maxOutputTokens: 1000,
    temperature: 0.7,
  })

  const tokensUsed = result.usage?.totalTokens ?? 0

  // Record response step
  stepNumber++
  await AgentSessionRepository.insertStep(client, {
    id: stepId(),
    sessionId: session.id,
    stepNumber,
    stepType: StepTypes.RESPONSE,
    content: { text: result.text },
    tokensUsed,
  })

  // Update session progress
  await AgentSessionRepository.updateCurrentStep(client, session.id, stepNumber)

  logger.info(
    {
      sessionId: session.id,
      steps: stepNumber,
      tokens: tokensUsed,
      responseLength: result.text.length,
    },
    "Companion agent completed",
  )

  return {
    response: result.text,
    tokensUsed,
    stepCount: stepNumber,
  }
}
