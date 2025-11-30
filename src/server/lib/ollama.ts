import ollama from "ollama"
import { Langfuse } from "langfuse"
import { logger } from "./logger"
import { LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL } from "../config"

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434"
const CLASSIFICATION_MODEL = process.env.OLLAMA_CLASSIFICATION_MODEL || "granite4:350m"
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text"

// Track whether Ollama embedding is available
let ollamaEmbeddingAvailable = false

// Initialize Langfuse client for manual tracing
const langfuse =
  LANGFUSE_SECRET_KEY && LANGFUSE_PUBLIC_KEY
    ? new Langfuse({
        secretKey: LANGFUSE_SECRET_KEY,
        publicKey: LANGFUSE_PUBLIC_KEY,
        baseUrl: LANGFUSE_BASE_URL,
      })
    : null

// ============================================================================
// Traced Ollama wrapper - automatically traces all generate() calls to Langfuse
// ============================================================================

interface TracedGenerateOptions {
  /** Name for the trace (e.g., "knowledge-classification", "auto-name") */
  traceName: string
  /** The prompt to send to the model */
  prompt: string
  /** Model to use (defaults to CLASSIFICATION_MODEL) */
  model?: string
  /** Temperature (defaults to 0) */
  temperature?: number
  /** Max tokens to generate (defaults to 100) */
  maxTokens?: number
  /** Additional metadata to include in the trace */
  metadata?: Record<string, unknown>
}

interface TracedGenerateResult {
  /** The raw response text from the model */
  text: string
  /** Token counts from Ollama */
  promptTokens: number
  evalTokens: number
  /** Duration in milliseconds */
  durationMs: number
}

/**
 * Wrapper around ollama.generate() that automatically traces to Langfuse.
 * Use this for all text generation calls to ensure consistent observability.
 */
async function tracedGenerate(options: TracedGenerateOptions): Promise<TracedGenerateResult> {
  const model = options.model || CLASSIFICATION_MODEL

  const trace = langfuse?.trace({
    name: options.traceName,
    metadata: {
      model,
      promptLength: options.prompt.length,
      ...options.metadata,
    },
  })

  const generation = trace?.generation({
    name: `ollama-${options.traceName}`,
    model,
    input: options.prompt,
    metadata: { provider: "ollama", host: OLLAMA_HOST },
  })

  const startTime = Date.now()

  try {
    const response = await ollama.generate({
      model,
      prompt: options.prompt,
      options: {
        temperature: options.temperature ?? 0,
        num_predict: options.maxTokens ?? 100,
      },
    })

    const durationMs = Date.now() - startTime
    const text = response.response.trim()
    const promptTokens = response.prompt_eval_count || estimateTokens(options.prompt)
    const evalTokens = response.eval_count || estimateTokens(text)

    generation?.end({
      output: text,
      usage: { input: promptTokens, output: evalTokens },
      metadata: {
        durationMs,
        totalDuration: response.total_duration,
        promptEvalDuration: response.prompt_eval_duration,
        evalDuration: response.eval_duration,
      },
    })

    return { text, promptTokens, evalTokens, durationMs }
  } catch (err) {
    const durationMs = Date.now() - startTime
    generation?.end({
      output: null,
      level: "ERROR",
      statusMessage: err instanceof Error ? err.message : "Unknown error",
      metadata: { durationMs },
    })
    throw err
  }
}

// ============================================================================
// Public API
// ============================================================================

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
  relevanceScore: number // 1-7 scale: 1 = clearly not for Ariadne, 7 = definitely for Ariadne
  confident: boolean
  rawResponse: string
}

export interface HelpfulnessScoreResult {
  score: number // 1-5 scale: 1 = not helpful, 5 = very helpful
  reasoning: string
  confident: boolean
}

/**
 * Classify content using a local SLM (Small Language Model) via Ollama.
 * Returns whether the content is knowledge-worthy and if the model was confident.
 */
export async function classifyWithSLM(content: string): Promise<ClassificationResult> {
  const prompt = `Is this message reusable knowledge (guides, how-tos, decisions, tips, troubleshooting, explanations) that would help others in the future?

Message:
${content.slice(0, 2000)}

Answer YES or NO, then briefly explain why in one sentence.`

  try {
    const result = await tracedGenerate({
      traceName: "knowledge-classification",
      prompt,
      metadata: { contentLength: content.length },
    })

    const upperText = result.text.toUpperCase()
    const startsWithYes = upperText.startsWith("YES")
    const startsWithNo = upperText.startsWith("NO")

    const classification = {
      isKnowledge: startsWithYes,
      confident: startsWithYes || startsWithNo,
      rawResponse: result.text,
    }

    logger.debug(
      { model: CLASSIFICATION_MODEL, ...classification, response: result.text.slice(0, 200) },
      "SLM classification result",
    )

    return classification
  } catch (err) {
    logger.error({ err, model: CLASSIFICATION_MODEL }, "SLM classification failed")
    return { isKnowledge: false, confident: false, rawResponse: "" }
  }
}

// Generic names that indicate the SLM didn't understand the task
const REJECTED_NAMES = [
  "message summary",
  "summary",
  "message",
  "title",
  "untitled",
  "no title",
  "thread",
  "conversation",
  "chat",
  "discussion",
  "question",
  "request",
  "help",
  "inquiry",
]

/**
 * Generate a short name/title for content using local SLM.
 * Used for auto-naming thinking spaces and threads.
 */
export async function generateAutoName(content: string): Promise<AutoNameResult> {
  const prompt = `What is this message about? Answer in 2-5 words. Be specific.

Examples:
- "How do I deploy to production?" → "Production deployment"
- "The API is returning 500 errors" → "API 500 errors"
- "Can someone review my PR?" → "PR review request"
- "Meeting notes from standup" → "Standup meeting notes"

Message:
${content.slice(0, 2000)}

Topic:`

  try {
    const result = await tracedGenerate({
      traceName: "auto-name-generation",
      prompt,
      temperature: 0.3,
      maxTokens: 50,
      metadata: { contentLength: content.length },
    })

    // Clean up the response
    let name = result.text
      .replace(/^["']|["']$/g, "") // Remove surrounding quotes
      .replace(/^(Title|Topic|Subject|Summary):\s*/i, "") // Remove common prefixes
      .replace(/\n.*/s, "") // Take only first line
      .trim()

    if (name.length > 50) {
      name = name.slice(0, 47) + "..."
    }

    // Reject generic/useless names
    if (!name || REJECTED_NAMES.includes(name.toLowerCase())) {
      logger.debug({ model: CLASSIFICATION_MODEL, rejectedName: name, contentLength: content.length }, "Rejected generic auto-name")
      return { name: "", success: false }
    }

    logger.debug({ model: CLASSIFICATION_MODEL, name, contentLength: content.length }, "Auto-name generated")
    return { name, success: true }
  } catch (err) {
    logger.error({ err, model: CLASSIFICATION_MODEL }, "Auto-name generation failed")
    return { name: "", success: false }
  }
}

/**
 * Check if a message in a conversation is intended for Ariadne.
 * Returns a relevance score on a 1-7 scale where 5+ warrants a response.
 */
export async function checkAriadneEngagement(
  message: string,
  recentContext: string,
  ariadneLastResponse?: string,
): Promise<EngagementCheckResult> {
  const prompt = `You are a content classifier given the task to determine if a message should be routed to an AI assistant that is a participant of the conversation.

The AI assistant is called Ariadna and her role is to answer questions that are addressed to her directly or that seem like follow up questions or requests for assistance.

She should not answer all messages in the thread as other participants might be discussing the topic. The closer her last message is to the new message, the more likely it is that the new message is intended for her, whereas if other participants are discussing the topic, the new message is likely not intended for her.
If the thread only contains messages from Ariadne and one other participant, the new message is likely intended for her.
${
  recentContext
    ? `Here is the history of the conversation inside triple quotes ("""):
"""${recentContext}""" :
`
    : ""
}

${
  ariadneLastResponse
    ? `Ariadne's last message inside triple quotes ("""):
"""${ariadneLastResponse.slice(0, 2000)}"""`
    : ""
}

New message inside triple quotes ("""):
"""${message.slice(0, 2000)}"""

Score 1-7 where:
1 = Definitely NOT for the AI (talking to humans)
4 = Unclear
7 = Definitely for the AI (asking for help, follow-up question)

Reply with just the number:
`

  try {
    const result = await tracedGenerate({
      traceName: "ariadne-engagement-check",
      prompt,
      maxTokens: 10,
      metadata: {
        messageLength: message.length,
        hasContext: !!ariadneLastResponse,
      },
    })

    // Parse the score - look for any digit 1-7 in the response
    const scoreMatch = result.text.match(/([1-7])/)
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 5
    const confident = scoreMatch !== null

    logger.info(
      { model: CLASSIFICATION_MODEL, relevanceScore: score, confident, rawResponse: result.text },
      "Ariadne engagement check result",
    )

    return { relevanceScore: score, confident, rawResponse: result.text }
  } catch (err) {
    logger.error({ err, model: CLASSIFICATION_MODEL }, "Ariadne engagement check failed")
    // Default to triggering response on error to avoid missing follow-ups
    return { relevanceScore: 5, confident: false, rawResponse: "" }
  }
}

/**
 * Score the helpfulness of an AI response given the question and context.
 * Used for tracking Ariadne's quality over time via Langfuse.
 *
 * @param question - The user's question or request
 * @param response - Ariadne's response
 * @param context - Optional additional context (conversation history, etc.)
 * @returns Score from 1-5 with reasoning
 */
export async function scoreHelpfulness(
  question: string,
  response: string,
  context?: string,
): Promise<HelpfulnessScoreResult> {
  const prompt = `Rate how helpful this AI assistant response is to the user's question.

${context ? `Context:\n${context.slice(0, 1000)}\n\n` : ""}User's question:
${question.slice(0, 500)}

AI response:
${response.slice(0, 2000)}

Score from 1-5:
1 = Not helpful at all (wrong, irrelevant, or evasive)
2 = Slightly helpful (partially addresses the question but missing key points)
3 = Moderately helpful (addresses the question but could be better)
4 = Helpful (good answer that addresses the question well)
5 = Very helpful (excellent answer, thorough, actionable, well-cited)

Respond with the score (1-5) followed by a brief reason (one sentence).
Format: [SCORE] - [REASON]

Example: 4 - Good explanation with code example but could cite sources better.

Your rating:`

  try {
    const result = await tracedGenerate({
      traceName: "helpfulness-scoring",
      prompt,
      temperature: 0.3,
      maxTokens: 100,
      metadata: {
        questionLength: question.length,
        responseLength: response.length,
        hasContext: !!context,
      },
    })

    // Parse the score - look for a digit 1-5 at the start
    const scoreMatch = result.text.match(/^([1-5])/)
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 3

    // Extract reasoning after the score
    const reasoningMatch = result.text.match(/^[1-5]\s*[-–:]\s*(.+)/)
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : result.text.slice(2).trim()

    const confident = scoreMatch !== null

    logger.debug(
      { model: CLASSIFICATION_MODEL, score, confident, reasoning: reasoning.slice(0, 100) },
      "Helpfulness score result",
    )

    return { score, reasoning, confident }
  } catch (err) {
    logger.error({ err, model: CLASSIFICATION_MODEL }, "Helpfulness scoring failed")
    return { score: 3, reasoning: "Scoring failed", confident: false }
  }
}

export interface ContextualHeaderResult {
  header: string
  success: boolean
}

export interface ContextMessage {
  author: string
  content: string
  isTarget?: boolean
}

/**
 * Generate a contextual header for a message to improve embedding quality.
 * The header captures conversation context, participants, and topic.
 */
export async function generateContextualHeader(
  targetMessage: ContextMessage,
  contextMessages: ContextMessage[],
  streamInfo: { name?: string; topic?: string; type?: string },
): Promise<ContextualHeaderResult> {
  const conversationContext = contextMessages
    .map((m) => `${m.author}: ${m.content.slice(0, 300)}${m.content.length > 300 ? "..." : ""}`)
    .join("\n")

  const prompt = `Generate a brief contextual header for this message. Include:
- What the conversation is about (1 sentence)
- Key participants and their roles if apparent
- Any relevant topic or context

Keep it under 80 words. Be factual and concise.

${streamInfo.name ? `Channel: #${streamInfo.name}` : ""}
${streamInfo.topic ? `Topic: ${streamInfo.topic}` : ""}
${streamInfo.type ? `Type: ${streamInfo.type}` : ""}

Conversation:
${conversationContext}

Target message:
${targetMessage.author}: ${targetMessage.content.slice(0, 500)}

Contextual header:`

  try {
    const result = await tracedGenerate({
      traceName: "contextual-header-generation",
      prompt,
      temperature: 0.3,
      maxTokens: 150,
      metadata: {
        streamName: streamInfo.name,
        contextMessageCount: contextMessages.length,
      },
    })

    const header = result.text
      .replace(/^(Header|Context|Summary):\s*/i, "")
      .trim()

    if (!header || header.length < 10) {
      logger.debug({ streamName: streamInfo.name }, "Generated header too short")
      return { header: "", success: false }
    }

    logger.debug(
      { model: CLASSIFICATION_MODEL, headerLength: header.length, streamName: streamInfo.name },
      "Contextual header generated",
    )
    return { header, success: true }
  } catch (err) {
    logger.error({ err, model: CLASSIFICATION_MODEL }, "Contextual header generation failed")
    return { header: "", success: false }
  }
}

// ============================================================================
// Embedding functions (not traced - high volume, low debugging value)
// ============================================================================

/**
 * Generate embedding using local Ollama model.
 * Returns null if Ollama is not available.
 */
export async function generateOllamaEmbedding(text: string): Promise<OllamaEmbeddingResult | null> {
  if (!ollamaEmbeddingAvailable) {
    return null
  }

  try {
    const response = await ollama.embed({
      model: EMBEDDING_MODEL,
      input: text,
    })

    return {
      embedding: response.embeddings[0],
      model: EMBEDDING_MODEL,
    }
  } catch (err) {
    logger.error({ err, model: EMBEDDING_MODEL }, "Ollama embedding failed")
    return null
  }
}

/**
 * Generate embeddings for multiple texts using local Ollama model.
 * Returns null if Ollama is not available.
 */
export async function generateOllamaEmbeddingsBatch(texts: string[]): Promise<OllamaEmbeddingResult[] | null> {
  if (!ollamaEmbeddingAvailable || texts.length === 0) {
    return null
  }

  try {
    const response = await ollama.embed({
      model: EMBEDDING_MODEL,
      input: texts,
    })

    return response.embeddings.map((embedding) => ({
      embedding,
      model: EMBEDDING_MODEL,
    }))
  } catch (err) {
    logger.error({ err, model: EMBEDDING_MODEL }, "Ollama batch embedding failed")
    return null
  }
}

// ============================================================================
// Health & Setup
// ============================================================================

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
