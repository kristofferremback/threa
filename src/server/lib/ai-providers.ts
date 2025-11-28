import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { logger } from "./logger"
import {
  isOllamaEmbeddingAvailable,
  generateOllamaEmbedding,
  generateOllamaEmbeddingsBatch,
  type OllamaTraceOptions,
} from "./ollama"
import type { AITraceService, TraceContext, Span } from "../services/ai-trace-service"

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

export const Models = {
  EMBEDDING: "text-embedding-3-small",
  CLAUDE_SONNET: "claude-sonnet-4-5-20250929",
  CLAUDE_HAIKU: "claude-haiku-4-5-20251001",
} as const

export const ModelCosts = {
  [Models.EMBEDDING]: { input: 2, output: 0 },
  [Models.CLAUDE_SONNET]: { input: 300, output: 1500 },
  [Models.CLAUDE_HAIKU]: { input: 25, output: 125 },
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

export interface AIProviderTraceOptions {
  traceService?: AITraceService
  context?: TraceContext
  parentSpan?: Span
}

/**
 * Generate embedding for a single text.
 * Uses Ollama (local) if available, falls back to OpenAI.
 */
export async function generateEmbedding(
  text: string,
  traceOptions?: AIProviderTraceOptions,
): Promise<EmbeddingResult> {
  // Try Ollama first (free, local)
  if (isOllamaEmbeddingAvailable()) {
    const ollamaTraceOptions: OllamaTraceOptions | undefined = traceOptions
      ? { traceService: traceOptions.traceService, context: traceOptions.context, parentSpan: traceOptions.parentSpan }
      : undefined

    const ollamaResult = await generateOllamaEmbedding(text, ollamaTraceOptions)
    if (ollamaResult) {
      logger.debug({ model: ollamaResult.model }, "Using local Ollama embedding")
      return {
        embedding: ollamaResult.embedding,
        model: ollamaResult.model,
        tokens: estimateTokens(text),
      }
    }
  }

  // Fallback to OpenAI
  const span = await startSpan(traceOptions, {
    operation: "openai.embed",
    provider: "openai",
    model: Models.EMBEDDING,
    input: text,
  })

  try {
    const openai = getOpenAIClient()
    const response = await openai.embeddings.create({
      model: Models.EMBEDDING,
      input: text,
    })

    await endSpan(span, {
      status: "success",
      inputTokens: response.usage.total_tokens,
      metadata: { embeddingDimension: response.data[0].embedding.length },
    })

    return {
      embedding: response.data[0].embedding,
      model: Models.EMBEDDING,
      tokens: response.usage.total_tokens,
    }
  } catch (err) {
    await endSpan(span, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: err instanceof Error ? err.name : undefined,
    })
    throw err
  }
}

/**
 * Generate embeddings for multiple texts in a single batch.
 * Uses Ollama (local) if available, falls back to OpenAI.
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  traceOptions?: AIProviderTraceOptions,
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return []

  // Try Ollama first (free, local)
  if (isOllamaEmbeddingAvailable()) {
    const ollamaTraceOptions: OllamaTraceOptions | undefined = traceOptions
      ? { traceService: traceOptions.traceService, context: traceOptions.context, parentSpan: traceOptions.parentSpan }
      : undefined

    const ollamaResults = await generateOllamaEmbeddingsBatch(texts, ollamaTraceOptions)
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
  const span = await startSpan(traceOptions, {
    operation: "openai.embed_batch",
    provider: "openai",
    model: Models.EMBEDDING,
    input: `[${texts.length} texts]`,
    metadata: { batchSize: texts.length },
  })

  try {
    const openai = getOpenAIClient()
    const maxBatchSize = 100
    const results: EmbeddingResult[] = []
    let totalTokens = 0

    for (let i = 0; i < texts.length; i += maxBatchSize) {
      const batch = texts.slice(i, i + maxBatchSize)

      const response = await openai.embeddings.create({
        model: Models.EMBEDDING,
        input: batch,
      })

      totalTokens += response.usage.total_tokens
      const avgTokens = response.usage.total_tokens / batch.length

      for (const data of response.data) {
        results.push({
          embedding: data.embedding,
          model: Models.EMBEDDING,
          tokens: Math.ceil(avgTokens),
        })
      }
    }

    await endSpan(span, {
      status: "success",
      inputTokens: totalTokens,
      metadata: {
        batchSize: texts.length,
        embeddingDimension: results[0]?.embedding.length,
      },
    })

    return results
  } catch (err) {
    await endSpan(span, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: err instanceof Error ? err.name : undefined,
    })
    throw err
  }
}

/**
 * Chat with Claude (Sonnet or Haiku).
 * Supports tool use for agentic interactions.
 */
export async function chat(
  params: {
    model: "claude-sonnet-4" | "claude-haiku"
    systemPrompt: string
    messages: ChatMessage[]
    tools?: ToolDefinition[]
    maxTokens?: number
    temperature?: number
  },
  traceOptions?: AIProviderTraceOptions,
): Promise<ChatResult> {
  const modelId = params.model === "claude-haiku" ? Models.CLAUDE_HAIKU : Models.CLAUDE_SONNET

  const inputPreview = params.messages.length > 0 ? params.messages[params.messages.length - 1].content : ""

  const span = await startSpan(traceOptions, {
    operation: "anthropic.chat",
    provider: "anthropic",
    model: modelId,
    input: inputPreview,
    metadata: {
      messageCount: params.messages.length,
      hasTools: !!params.tools?.length,
      toolCount: params.tools?.length || 0,
    },
  })

  try {
    const anthropic = getAnthropicClient()

    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: params.maxTokens ?? 1024,
      system: params.systemPrompt,
      messages: params.messages,
      tools: params.tools as Anthropic.Tool[],
      temperature: params.temperature,
    })

    const textContent = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("")

    const toolCalls = response.content
      .filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use")
      .map((c) => ({
        id: c.id,
        name: c.name,
        input: c.input as Record<string, unknown>,
      }))

    await endSpan(span, {
      status: "success",
      output: textContent,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      metadata: {
        stopReason: response.stop_reason,
        toolCallCount: toolCalls.length,
        toolCalls: toolCalls.map((t) => t.name),
      },
    })

    return {
      content: textContent,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: response.stop_reason || "end_turn",
    }
  } catch (err) {
    await endSpan(span, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: err instanceof Error ? err.name : undefined,
    })
    throw err
  }
}

/**
 * Classify content using Claude Haiku (fallback when SLM is uncertain).
 */
export async function classifyWithHaiku(
  content: string,
  reactionCount?: number,
  traceOptions?: AIProviderTraceOptions,
): Promise<{
  isKnowledge: boolean
  confidence: number
  suggestedTitle: string | null
  usage: { inputTokens: number; outputTokens: number }
}> {
  const span = await startSpan(traceOptions, {
    operation: "anthropic.classify",
    provider: "anthropic",
    model: Models.CLAUDE_HAIKU,
    input: content.slice(0, 500),
    metadata: { reactionCount },
  })

  try {
    const result = await chat(
      {
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
      },
      // Don't pass traceOptions to inner chat call - we're tracing at this level
    )

    const jsonMatch = result.content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("No JSON found in response")
    }

    const parsed = JSON.parse(jsonMatch[0])
    const classification = {
      isKnowledge: parsed.isKnowledge === true,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      suggestedTitle: typeof parsed.suggestedTitle === "string" ? parsed.suggestedTitle : null,
      usage: result.usage,
    }

    await endSpan(span, {
      status: "success",
      output: result.content,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      metadata: {
        isKnowledge: classification.isKnowledge,
        confidence: classification.confidence,
      },
    })

    return classification
  } catch (err) {
    logger.error({ err }, "Failed to parse Haiku classification response")

    await endSpan(span, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: err instanceof Error ? err.name : undefined,
    })

    return {
      isKnowledge: false,
      confidence: 0,
      suggestedTitle: null,
      usage: { inputTokens: 0, outputTokens: 0 },
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
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Helper functions for optional tracing

interface SpanStartOptions {
  operation: string
  provider: "anthropic" | "openai"
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
  traceOptions: AIProviderTraceOptions | undefined,
  options: SpanStartOptions,
): Promise<Span | null> {
  if (!traceOptions?.traceService || !traceOptions?.context) {
    return null
  }

  if (traceOptions.parentSpan) {
    return traceOptions.parentSpan.child({
      operation: options.operation,
      provider: options.provider,
      model: options.model,
      input: options.input,
      metadata: options.metadata,
    })
  }

  return traceOptions.traceService.startSpan(traceOptions.context, {
    operation: options.operation,
    provider: options.provider,
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
