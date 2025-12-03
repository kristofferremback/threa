import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import ollama from "ollama"
import { logger } from "./logger"
import { isOllamaEmbeddingAvailable, generateOllamaEmbedding, generateOllamaEmbeddingsBatch } from "./ollama"
import {
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
  OPENROUTER_API_KEY,
  ARIADNE_MODEL,
  CLASSIFICATION_MODEL,
  OPENAI_EMBEDDING_MODEL,
} from "../config"

// ============================================================================
// Provider types and model parsing
// ============================================================================

export type Provider = "ollama" | "openai" | "anthropic" | "openrouter"

export interface ModelConfig {
  provider: Provider
  model: string
  temperature?: number
}

/**
 * Parse model string into provider and model name.
 * Format: provider:model (e.g., "ollama:granite4:1b", "openai:gpt-4o-mini", "anthropic:claude-haiku-4-5-20251001")
 * Default provider is "anthropic" if not specified (for backwards compatibility).
 */
export function parseModelString(modelString: string): ModelConfig {
  const parts = modelString.split(":")

  if (parts[0] === "ollama") {
    return {
      provider: "ollama",
      model: parts.slice(1).join(":"),
      temperature: 0.1,
    }
  }

  if (parts[0] === "openai") {
    return {
      provider: "openai",
      model: parts.slice(1).join(":"),
      temperature: 1,
    }
  }

  if (parts[0] === "anthropic") {
    return {
      provider: "anthropic",
      model: parts.slice(1).join(":"),
      temperature: 0.1,
    }
  }

  if (parts[0] === "openrouter") {
    return {
      provider: "openrouter",
      // OpenRouter uses slashes in model IDs: google/gemma-3-12b-it
      // The format is openrouter:provider/model, so we join with / after removing the provider prefix
      model: parts.slice(1).join("/"),
      temperature: 0.7,
    }
  }

  // Default to anthropic if no provider prefix (backwards compatibility)
  return {
    provider: "anthropic",
    model: modelString,
    temperature: 0.1,
  }
}

// ============================================================================
// Lazy-loaded clients
// ============================================================================

let _anthropic: Anthropic | null = null
let _openai: OpenAI | null = null
let _openrouter: OpenAI | null = null

function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set")
    }
    _anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  }
  return _anthropic
}

function getOpenAIClient(): OpenAI {
  if (!_openai) {
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is not set")
    }
    _openai = new OpenAI({ apiKey: OPENAI_API_KEY })
  }
  return _openai
}

function getOpenRouterClient(): OpenAI {
  if (!_openrouter) {
    if (!OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY environment variable is not set")
    }
    _openrouter = new OpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://threa.app",
        "X-Title": "Threa",
      },
    })
  }
  return _openrouter
}

/**
 * Check if AI providers are configured.
 */
export function isAIConfigured(): { openai: boolean; anthropic: boolean; openrouter: boolean } {
  return {
    openai: !!OPENAI_API_KEY,
    anthropic: !!ANTHROPIC_API_KEY,
    openrouter: !!OPENROUTER_API_KEY,
  }
}

// ============================================================================
// Multi-provider chat function
// ============================================================================

export interface SimpleChatParams {
  systemPrompt: string
  userMessage: string
  maxTokens?: number
  temperature?: number
}

export interface SimpleChatResult {
  content: string
  usage: {
    inputTokens: number
    outputTokens: number
  }
  model: string
  provider: Provider
}

/**
 * Chat with any provider using the model string format: provider:model
 * Examples:
 *   - anthropic:claude-haiku-4-5-20251001
 *   - openrouter:google/gemma-3-12b-it
 *   - ollama:granite4:1b
 *   - openai:gpt-4o-mini
 */
export async function chatWithModel(
  modelString: string,
  params: SimpleChatParams,
): Promise<SimpleChatResult> {
  const config = parseModelString(modelString)
  const temperature = params.temperature ?? config.temperature ?? 0.1
  const maxTokens = params.maxTokens ?? 1024

  switch (config.provider) {
    case "anthropic":
      return chatWithAnthropic(config.model, params.systemPrompt, params.userMessage, maxTokens, temperature)
    case "openai":
      return chatWithOpenAI(config.model, params.systemPrompt, params.userMessage, maxTokens, temperature)
    case "openrouter":
      return chatWithOpenRouter(config.model, params.systemPrompt, params.userMessage, maxTokens, temperature)
    case "ollama":
      return chatWithOllama(config.model, params.systemPrompt, params.userMessage, maxTokens, temperature)
    default:
      throw new Error(`Unknown provider: ${config.provider}`)
  }
}

async function chatWithAnthropic(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
): Promise<SimpleChatResult> {
  const client = getAnthropicClient()

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    temperature,
  })

  const content = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("")

  return {
    content,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    model,
    provider: "anthropic",
  }
}

async function chatWithOpenAI(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
): Promise<SimpleChatResult> {
  const client = getOpenAIClient()

  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature,
  })

  return {
    content: response.choices[0]?.message?.content ?? "",
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
    model,
    provider: "openai",
  }
}

async function chatWithOpenRouter(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
): Promise<SimpleChatResult> {
  const client = getOpenRouterClient()

  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature,
  })

  return {
    content: response.choices[0]?.message?.content ?? "",
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
    model,
    provider: "openrouter",
  }
}

async function chatWithOllama(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
): Promise<SimpleChatResult> {
  const response = await ollama.chat({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    options: {
      temperature,
      num_predict: maxTokens,
    },
  })

  // Ollama doesn't provide token counts, so estimate
  const inputTokens = estimateTokens(systemPrompt + userMessage)
  const outputTokens = estimateTokens(response.message.content)

  return {
    content: response.message.content,
    usage: {
      inputTokens,
      outputTokens,
    },
    model,
    provider: "ollama",
  }
}

// Model constants - use config values for runtime configuration
export const Models = {
  EMBEDDING: OPENAI_EMBEDDING_MODEL,
  CLAUDE_SONNET: "claude-sonnet-4-5-20250929",
  CLAUDE_HAIKU: CLASSIFICATION_MODEL,
  ARIADNE: ARIADNE_MODEL,
} as const

// Cost per 1M tokens (in cents) - keyed by model ID patterns
// Note: Costs are approximate and should be updated as pricing changes
const MODEL_COST_PATTERNS: Array<{ pattern: RegExp | string; costs: { input: number; output: number } }> = [
  // OpenAI embeddings
  { pattern: /^text-embedding/, costs: { input: 2, output: 0 } }, // $0.02/1M
  // Anthropic models
  { pattern: /claude-sonnet/, costs: { input: 300, output: 1500 } }, // $3/1M in, $15/1M out
  { pattern: /claude-haiku/, costs: { input: 25, output: 125 } }, // $0.25/1M in, $1.25/1M out
  { pattern: /claude-opus/, costs: { input: 1500, output: 7500 } }, // $15/1M in, $75/1M out
]

// Legacy export for backwards compatibility
export const ModelCosts = {
  "text-embedding-3-small": { input: 2, output: 0 },
  "claude-sonnet-4-5-20250929": { input: 300, output: 1500 },
  "claude-haiku-4-5-20251001": { input: 25, output: 125 },
} as const

/**
 * Get cost per 1M tokens for a model.
 * Returns default Haiku costs if model not recognized.
 */
export function getModelCosts(model: string): { input: number; output: number } {
  // Check patterns
  for (const { pattern, costs } of MODEL_COST_PATTERNS) {
    if (typeof pattern === "string" ? model === pattern : pattern.test(model)) {
      return costs
    }
  }
  // Default to Haiku costs
  return { input: 25, output: 125 }
}

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
 * Classify content using the configured classification model.
 * Uses CLASSIFICATION_MODEL env var (format: provider:model).
 * Defaults to anthropic:claude-haiku-4-5-20251001.
 */
export async function classifyWithModel(
  content: string,
  reactionCount?: number,
): Promise<{
  isKnowledge: boolean
  confidence: number
  suggestedTitle: string | null
  usage: { inputTokens: number; outputTokens: number }
  model: string
  provider: Provider
}> {
  const systemPrompt = `You are a content classifier. Analyze messages to determine if they contain reusable knowledge that would help others in the future.

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

Respond with JSON only, no other text.`

  const userMessage = `Classify this message:

${content.slice(0, 2000)}

${reactionCount && reactionCount > 0 ? `Note: ${reactionCount} people reacted positively to this message.` : ""}

Respond with JSON:
{"isKnowledge": boolean, "confidence": 0.0-1.0, "suggestedTitle": "string or null"}`

  const result = await chatWithModel(CLASSIFICATION_MODEL, {
    systemPrompt,
    userMessage,
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
      model: result.model,
      provider: result.provider,
    }
  } catch (err) {
    logger.error({ err, response: result.content, model: result.model }, "Failed to parse classification response")
    return {
      isKnowledge: false,
      confidence: 0,
      suggestedTitle: null,
      usage: result.usage,
      model: result.model,
      provider: result.provider,
    }
  }
}

/**
 * @deprecated Use classifyWithModel instead. This is kept for backwards compatibility.
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
  const result = await classifyWithModel(content, reactionCount)
  return {
    isKnowledge: result.isKnowledge,
    confidence: result.confidence,
    suggestedTitle: result.suggestedTitle,
    usage: result.usage,
  }
}

/**
 * Calculate cost in cents for an AI operation.
 * Accepts any model string and looks up costs dynamically.
 */
export function calculateCost(
  model: string,
  usage: { inputTokens: number; outputTokens?: number },
): number {
  const costs = getModelCosts(model)
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
