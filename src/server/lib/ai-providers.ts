import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { logger } from "./logger"
import {
  isOllamaEmbeddingAvailable,
  generateOllamaEmbedding,
  generateOllamaEmbeddingsBatch,
} from "./ollama"

// Lazy-loaded clients - only initialized when first used
let _anthropic: Anthropic | null = null
let _openai: OpenAI | null = null

function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set")
    }
    _anthropic = new Anthropic({ apiKey })
  }
  return _anthropic
}

function getOpenAIClient(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set")
    }
    _openai = new OpenAI({ apiKey })
  }
  return _openai
}

/**
 * Check if AI providers are configured.
 */
export function isAIConfigured(): { openai: boolean; anthropic: boolean } {
  return {
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
  }
}

// Model constants
export const Models = {
  EMBEDDING: "text-embedding-3-small",
  CLAUDE_SONNET: "claude-sonnet-4-5-20250929",
  CLAUDE_HAIKU: "claude-3-5-haiku-20241022",
} as const

// Cost per 1M tokens (in cents)
export const ModelCosts = {
  [Models.EMBEDDING]: { input: 2, output: 0 }, // $0.02/1M
  [Models.CLAUDE_SONNET]: { input: 300, output: 1500 }, // $3/1M in, $15/1M out
  [Models.CLAUDE_HAIKU]: { input: 25, output: 125 }, // $0.25/1M in, $1.25/1M out
} as const

export interface EmbeddingResult {
  embedding: number[]
  model: string
  tokens: number
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ChatResult {
  content: string
  usage: {
    inputTokens: number
    outputTokens: number
  }
  toolCalls?: ToolCall[]
  stopReason: string
}

/**
 * Generate embedding for a single text.
 * Uses Ollama (local) if available, falls back to OpenAI.
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  // Try Ollama first (free, local)
  if (isOllamaEmbeddingAvailable()) {
    const ollamaResult = await generateOllamaEmbedding(text)
    if (ollamaResult) {
      logger.debug({ model: ollamaResult.model }, "Using local Ollama embedding")
      return {
        embedding: ollamaResult.embedding,
        model: ollamaResult.model,
        tokens: estimateTokens(text), // Estimate since Ollama doesn't report tokens
      }
    }
  }

  // Fallback to OpenAI
  const openai = getOpenAIClient()
  const response = await openai.embeddings.create({
    model: Models.EMBEDDING,
    input: text,
  })

  return {
    embedding: response.data[0].embedding,
    model: Models.EMBEDDING,
    tokens: response.usage.total_tokens,
  }
}

/**
 * Generate embeddings for multiple texts in a single batch.
 * Uses Ollama (local) if available, falls back to OpenAI.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return []

  // Try Ollama first (free, local)
  if (isOllamaEmbeddingAvailable()) {
    const ollamaResults = await generateOllamaEmbeddingsBatch(texts)
    if (ollamaResults) {
      logger.debug({ model: ollamaResults[0]?.model, count: texts.length }, "Using local Ollama embeddings")
      return ollamaResults.map((r, i) => ({
        embedding: r.embedding,
        model: r.model,
        tokens: estimateTokens(texts[i]),
      }))
    }
  }

  // Fallback to OpenAI
  const openai = getOpenAIClient()

  // OpenAI supports up to 2048 texts per batch, but we limit to 100 for memory
  const maxBatchSize = 100
  const results: EmbeddingResult[] = []

  for (let i = 0; i < texts.length; i += maxBatchSize) {
    const batch = texts.slice(i, i + maxBatchSize)

    const response = await openai.embeddings.create({
      model: Models.EMBEDDING,
      input: batch,
    })

    const avgTokens = response.usage.total_tokens / batch.length

    for (const data of response.data) {
      results.push({
        embedding: data.embedding,
        model: Models.EMBEDDING,
        tokens: Math.ceil(avgTokens),
      })
    }
  }

  return results
}

/**
 * Chat with Claude (Sonnet or Haiku).
 * Supports tool use for agentic interactions.
 */
export async function chat(params: {
  model: "claude-sonnet-4" | "claude-haiku"
  systemPrompt: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
}): Promise<ChatResult> {
  const anthropic = getAnthropicClient()
  const modelId = params.model === "claude-haiku" ? Models.CLAUDE_HAIKU : Models.CLAUDE_SONNET

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: params.maxTokens ?? 1024,
    system: params.systemPrompt,
    messages: params.messages,
    tools: params.tools as Anthropic.Tool[],
    temperature: params.temperature,
  })

  // Extract text content
  const textContent = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("")

  // Extract tool calls
  const toolCalls = response.content
    .filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use")
    .map((c) => ({
      id: c.id,
      name: c.name,
      input: c.input as Record<string, unknown>,
    }))

  return {
    content: textContent,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    stopReason: response.stop_reason || "end_turn",
  }
}

/**
 * Classify content using Claude Haiku (fallback when SLM is uncertain).
 */
export async function classifyWithHaiku(
  content: string,
  reactionCount?: number,
): Promise<{
  isKnowledge: boolean
  confidence: number
  suggestedTitle: string | null
  usage: { inputTokens: number; outputTokens: number }
}> {
  const result = await chat({
    model: "claude-haiku",
    systemPrompt: `You are a content classifier. Analyze messages to determine if they contain reusable knowledge that would help others in the future.

Knowledge includes:
- How-to guides and explanations
- Troubleshooting steps and solutions
- Decisions and their rationale
- Tips, best practices, and recommendations
- Technical documentation or processes

NOT knowledge:
- Casual conversation and greetings
- Simple acknowledgments (ok, thanks, etc.)
- Status updates and scheduling
- Questions without answers
- Context-dependent discussions

Respond with JSON only, no other text.`,
    messages: [
      {
        role: "user",
        content: `Classify this message:

${content.slice(0, 2000)}

${reactionCount && reactionCount > 0 ? `Note: ${reactionCount} people reacted positively to this message.` : ""}

Respond with JSON:
{"isKnowledge": boolean, "confidence": 0.0-1.0, "suggestedTitle": "string or null"}`,
      },
    ],
    maxTokens: 150,
    temperature: 0,
  })

  try {
    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = result.content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("No JSON found in response")
    }

    const parsed = JSON.parse(jsonMatch[0])
    return {
      isKnowledge: parsed.isKnowledge === true,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      suggestedTitle: typeof parsed.suggestedTitle === "string" ? parsed.suggestedTitle : null,
      usage: result.usage,
    }
  } catch (err) {
    logger.error({ err, response: result.content }, "Failed to parse Haiku classification response")
    return {
      isKnowledge: false,
      confidence: 0,
      suggestedTitle: null,
      usage: result.usage,
    }
  }
}

/**
 * Calculate cost in cents for an AI operation.
 */
export function calculateCost(
  model: keyof typeof ModelCosts,
  usage: { inputTokens: number; outputTokens?: number },
): number {
  const costs = ModelCosts[model]
  const inputCost = (usage.inputTokens / 1_000_000) * costs.input
  const outputCost = usage.outputTokens ? (usage.outputTokens / 1_000_000) * costs.output : 0
  return inputCost + outputCost
}

/**
 * Estimate tokens for a text (rough approximation).
 * Claude uses ~4 chars per token on average.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

