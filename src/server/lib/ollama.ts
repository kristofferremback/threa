import ollama from "ollama"
import { logger } from "./logger"
import type { AITraceService, TraceContext, Span } from "../services/ai-trace-service"

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434"
const CLASSIFICATION_MODEL = process.env.OLLAMA_CLASSIFICATION_MODEL || "granite4:350m"
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text"

let ollamaEmbeddingAvailable = false

export interface ClassificationResult {
  isKnowledge: boolean
  confident: boolean
  rawResponse: string
}

export interface AutoNameResult {
  name: string
  success: boolean
}

export interface OllamaEmbeddingResult {
  embedding: number[]
  model: string
}

export interface EngagementCheckResult {
  isDirectedAtAriadne: boolean
  topicChanged: boolean
  confident: boolean
  rawResponse: string
}

export interface OllamaTraceOptions {
  traceService?: AITraceService
  context?: TraceContext
  parentSpan?: Span
}

/**
 * Classify content using a local SLM (Small Language Model) via Ollama.
 */
export async function classifyWithSLM(
  content: string,
  traceOptions?: OllamaTraceOptions,
): Promise<ClassificationResult> {
  const prompt = `Is this message reusable knowledge (guides, how-tos, decisions, tips, troubleshooting, explanations) that would help others in the future?

Message:
${content.slice(0, 1500)}

Answer YES or NO, then briefly explain why in one sentence.`

  const span = await startSpan(traceOptions, {
    operation: "ollama.classify",
    model: CLASSIFICATION_MODEL,
    input: prompt,
  })

  try {
    const response = await ollama.generate({
      model: CLASSIFICATION_MODEL,
      prompt,
      options: {
        temperature: 0,
        num_predict: 100,
      },
    })

    const text = response.response.trim()
    const upperText = text.toUpperCase()

    const startsWithYes = upperText.startsWith("YES")
    const startsWithNo = upperText.startsWith("NO")
    const isKnowledge = startsWithYes
    const confident = startsWithYes || startsWithNo

    logger.debug(
      { model: CLASSIFICATION_MODEL, isKnowledge, confident, response: text.slice(0, 200) },
      "SLM classification result",
    )

    await endSpan(span, {
      status: "success",
      output: text,
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(text),
      metadata: { isKnowledge, confident },
    })

    return { isKnowledge, confident, rawResponse: text }
  } catch (err) {
    logger.error({ err, model: CLASSIFICATION_MODEL }, "SLM classification failed")

    await endSpan(span, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: err instanceof Error ? err.name : undefined,
    })

    return { isKnowledge: false, confident: false, rawResponse: "" }
  }
}

/**
 * Generate a short name/title for content using local SLM.
 */
export async function generateAutoName(
  content: string,
  traceOptions?: OllamaTraceOptions,
): Promise<AutoNameResult> {
  const prompt = `Generate a short title (maximum 5 words) for this message.
If the message isn't already in English, first translate it to English, then summarize it in five words, no more.
Only output the title, nothing else.

Message:
${content.slice(0, 500)}

Title:`

  const span = await startSpan(traceOptions, {
    operation: "ollama.autoname",
    model: CLASSIFICATION_MODEL,
    input: prompt,
  })

  try {
    const response = await ollama.generate({
      model: CLASSIFICATION_MODEL,
      prompt,
      options: {
        temperature: 0.3,
        num_predict: 20,
      },
    })

    let name = response.response
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/^Title:\s*/i, "")
      .replace(/\n.*/s, "")
      .trim()

    if (name.length > 50) {
      name = name.slice(0, 47) + "..."
    }

    if (!name) {
      await endSpan(span, {
        status: "success",
        output: response.response,
        inputTokens: estimateTokens(prompt),
        outputTokens: estimateTokens(response.response),
        metadata: { success: false, reason: "empty_result" },
      })
      return { name: "", success: false }
    }

    logger.debug({ model: CLASSIFICATION_MODEL, name, contentLength: content.length }, "Auto-name generated")

    await endSpan(span, {
      status: "success",
      output: name,
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(response.response),
      metadata: { success: true },
    })

    return { name, success: true }
  } catch (err) {
    logger.error({ err, model: CLASSIFICATION_MODEL }, "Auto-name generation failed")

    await endSpan(span, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: err instanceof Error ? err.name : undefined,
    })

    return { name: "", success: false }
  }
}

/**
 * Check if a message is directed at Ariadne.
 */
export async function checkAriadneEngagement(
  message: string,
  recentContext: string,
  ariadneLastResponse?: string,
  traceOptions?: OllamaTraceOptions,
): Promise<EngagementCheckResult> {
  const contextSection = ariadneLastResponse
    ? `Ariadne's last response:
${ariadneLastResponse.slice(0, 500)}

Recent conversation:
${recentContext.slice(0, 1000)}`
    : `Recent conversation:
${recentContext.slice(0, 1000)}`

  const prompt = `You are analyzing a conversation where an AI assistant named Ariadne has been participating.
Determine if the new message is directed at Ariadne or is a follow-up to her previous response.

${contextSection}

New message:
${message.slice(0, 500)}

Consider:
1. Is this a follow-up question or response to Ariadne?
2. Is the user asking for more help, clarification, or continuing the AI conversation?
3. Has the topic completely changed to something unrelated where Ariadne wouldn't be needed?

Answer with exactly one of these formats:
DIRECTED - if the message is meant for Ariadne or continues the AI conversation
UNDIRECTED - if the message is clearly to other humans and not related to Ariadne
TOPIC_CHANGED - if the conversation has moved to a completely different topic

Then briefly explain why in one sentence.`

  const span = await startSpan(traceOptions, {
    operation: "ollama.engagement_check",
    model: CLASSIFICATION_MODEL,
    input: prompt,
  })

  try {
    const response = await ollama.generate({
      model: CLASSIFICATION_MODEL,
      prompt,
      options: {
        temperature: 0,
        num_predict: 100,
      },
    })

    const text = response.response.trim()
    const upperText = text.toUpperCase()

    const isDirected = upperText.startsWith("DIRECTED")
    const isUndirected = upperText.startsWith("UNDIRECTED")
    const topicChanged = upperText.startsWith("TOPIC_CHANGED")
    const confident = isDirected || isUndirected || topicChanged

    logger.debug(
      { model: CLASSIFICATION_MODEL, isDirected, topicChanged, confident, response: text.slice(0, 200) },
      "Ariadne engagement check result",
    )

    await endSpan(span, {
      status: "success",
      output: text,
      inputTokens: estimateTokens(prompt),
      outputTokens: estimateTokens(text),
      metadata: { isDirected, topicChanged, confident },
    })

    return {
      isDirectedAtAriadne: isDirected,
      topicChanged,
      confident,
      rawResponse: text,
    }
  } catch (err) {
    logger.error({ err, model: CLASSIFICATION_MODEL }, "Ariadne engagement check failed")

    await endSpan(span, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: err instanceof Error ? err.name : undefined,
    })

    return { isDirectedAtAriadne: true, topicChanged: false, confident: false, rawResponse: "" }
  }
}

/**
 * Generate embedding using local Ollama model.
 */
export async function generateOllamaEmbedding(
  text: string,
  traceOptions?: OllamaTraceOptions,
): Promise<OllamaEmbeddingResult | null> {
  if (!ollamaEmbeddingAvailable) {
    return null
  }

  const span = await startSpan(traceOptions, {
    operation: "ollama.embed",
    model: EMBEDDING_MODEL,
    input: text,
  })

  try {
    const response = await ollama.embed({
      model: EMBEDDING_MODEL,
      input: text,
    })

    await endSpan(span, {
      status: "success",
      inputTokens: estimateTokens(text),
      metadata: { embeddingDimension: response.embeddings[0]?.length },
    })

    return {
      embedding: response.embeddings[0],
      model: EMBEDDING_MODEL,
    }
  } catch (err) {
    logger.error({ err, model: EMBEDDING_MODEL }, "Ollama embedding failed")

    await endSpan(span, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: err instanceof Error ? err.name : undefined,
    })

    return null
  }
}

/**
 * Generate embeddings for multiple texts using local Ollama model.
 */
export async function generateOllamaEmbeddingsBatch(
  texts: string[],
  traceOptions?: OllamaTraceOptions,
): Promise<OllamaEmbeddingResult[] | null> {
  if (!ollamaEmbeddingAvailable || texts.length === 0) {
    return null
  }

  const span = await startSpan(traceOptions, {
    operation: "ollama.embed_batch",
    model: EMBEDDING_MODEL,
    input: `[${texts.length} texts]`,
    metadata: { batchSize: texts.length },
  })

  try {
    const response = await ollama.embed({
      model: EMBEDDING_MODEL,
      input: texts,
    })

    const totalTokens = texts.reduce((sum, t) => sum + estimateTokens(t), 0)

    await endSpan(span, {
      status: "success",
      inputTokens: totalTokens,
      metadata: {
        batchSize: texts.length,
        embeddingDimension: response.embeddings[0]?.length,
      },
    })

    return response.embeddings.map((embedding) => ({
      embedding,
      model: EMBEDDING_MODEL,
    }))
  } catch (err) {
    logger.error({ err, model: EMBEDDING_MODEL }, "Ollama batch embedding failed")

    await endSpan(span, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: err instanceof Error ? err.name : undefined,
    })

    return null
  }
}

/**
 * Check if Ollama is available and required models are loaded.
 */
export async function checkOllamaHealth(): Promise<{
  available: boolean
  classificationModelLoaded: boolean
  embeddingModelLoaded: boolean
  error?: string
}> {
  try {
    const models = await ollama.list()
    const classificationModelLoaded = models.models.some(
      (m) => m.name === CLASSIFICATION_MODEL || m.name.startsWith(CLASSIFICATION_MODEL.split(":")[0]),
    )
    const embeddingModelLoaded = models.models.some(
      (m) => m.name === EMBEDDING_MODEL || m.name.startsWith(EMBEDDING_MODEL.split(":")[0]),
    )

    ollamaEmbeddingAvailable = embeddingModelLoaded

    return { available: true, classificationModelLoaded, embeddingModelLoaded }
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error"
    logger.warn({ err, host: OLLAMA_HOST }, "Ollama health check failed")
    ollamaEmbeddingAvailable = false
    return { available: false, classificationModelLoaded: false, embeddingModelLoaded: false, error }
  }
}

/**
 * Check if Ollama embeddings are available.
 */
export function isOllamaEmbeddingAvailable(): boolean {
  return ollamaEmbeddingAvailable
}

/**
 * Ensure required Ollama models are available.
 */
export async function ensureOllamaModels(): Promise<void> {
  const health = await checkOllamaHealth()

  if (!health.available) {
    logger.warn("Ollama not available, skipping model pull")
    return
  }

  if (!health.classificationModelLoaded) {
    logger.info({ model: CLASSIFICATION_MODEL }, "Pulling classification model...")
    try {
      await ollama.pull({ model: CLASSIFICATION_MODEL })
      logger.info({ model: CLASSIFICATION_MODEL }, "Classification model pulled successfully")
    } catch (err) {
      logger.error({ err, model: CLASSIFICATION_MODEL }, "Failed to pull classification model")
    }
  }

  if (!health.embeddingModelLoaded) {
    logger.info({ model: EMBEDDING_MODEL }, "Pulling embedding model...")
    try {
      await ollama.pull({ model: EMBEDDING_MODEL })
      ollamaEmbeddingAvailable = true
      logger.info({ model: EMBEDDING_MODEL }, "Embedding model pulled successfully")
    } catch (err) {
      logger.error({ err, model: EMBEDDING_MODEL }, "Failed to pull embedding model")
    }
  }
}

/**
 * Estimate tokens for a text (rough approximation: ~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
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
  traceOptions: OllamaTraceOptions | undefined,
  options: SpanStartOptions,
): Promise<Span | null> {
  if (!traceOptions?.traceService || !traceOptions?.context) {
    return null
  }

  if (traceOptions.parentSpan) {
    return traceOptions.parentSpan.child({
      operation: options.operation,
      provider: "ollama",
      model: options.model,
      input: options.input,
      metadata: options.metadata,
    })
  }

  return traceOptions.traceService.startSpan(traceOptions.context, {
    operation: options.operation,
    provider: "ollama",
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
