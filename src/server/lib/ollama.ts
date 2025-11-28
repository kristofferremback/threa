import ollama from "ollama"
import { logger } from "./logger"

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434"
const CLASSIFICATION_MODEL = process.env.OLLAMA_CLASSIFICATION_MODEL || "granite4:350m"
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text"

// Track whether Ollama embedding is available
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

/**
 * Classify content using a local SLM (Small Language Model) via Ollama.
 * Returns whether the content is knowledge-worthy and if the model was confident.
 *
 * Uses granite4:350m by default - a hybrid Mamba-2/Transformer model optimized
 * for edge deployment and classification tasks.
 */
export async function classifyWithSLM(content: string): Promise<ClassificationResult> {
  try {
    const response = await ollama.generate({
      model: CLASSIFICATION_MODEL,
      prompt: `Is this message reusable knowledge (guides, how-tos, decisions, tips, troubleshooting, explanations) that would help others in the future?

Message:
${content.slice(0, 1500)}

Answer YES or NO, then briefly explain why in one sentence.`,
      options: {
        temperature: 0,
        num_predict: 100,
      },
    })

    const text = response.response.trim()
    const upperText = text.toUpperCase()

    // Check for clear YES or NO at the start
    const startsWithYes = upperText.startsWith("YES")
    const startsWithNo = upperText.startsWith("NO")
    const isKnowledge = startsWithYes
    const confident = startsWithYes || startsWithNo

    logger.debug(
      { model: CLASSIFICATION_MODEL, isKnowledge, confident, response: text.slice(0, 200) },
      "SLM classification result",
    )

    return { isKnowledge, confident, rawResponse: text }
  } catch (err) {
    logger.error({ err, model: CLASSIFICATION_MODEL }, "SLM classification failed")
    // Return uncertain result so it escalates to API
    return { isKnowledge: false, confident: false, rawResponse: "" }
  }
}

/**
 * Generate a short name/title for content using local SLM.
 * Handles international messages by first translating to English.
 * Used for auto-naming thinking spaces and threads.
 */
export async function generateAutoName(content: string): Promise<AutoNameResult> {
  try {
    const response = await ollama.generate({
      model: CLASSIFICATION_MODEL,
      prompt: `Generate a short title (maximum 5 words) for this message.
If the message isn't already in English, first translate it to English, then summarize it in five words, no more.
Only output the title, nothing else.

Message:
${content.slice(0, 500)}

Title:`,
      options: {
        temperature: 0.3,
        num_predict: 20,
      },
    })

    // Clean up the response - remove quotes, extra whitespace, etc.
    let name = response.response
      .trim()
      .replace(/^["']|["']$/g, "") // Remove surrounding quotes
      .replace(/^Title:\s*/i, "") // Remove "Title:" prefix if model included it
      .replace(/\n.*/s, "") // Take only first line
      .trim()

    // Ensure it's not too long (truncate to ~50 chars if needed)
    if (name.length > 50) {
      name = name.slice(0, 47) + "..."
    }

    // Fallback if empty
    if (!name) {
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

    // Update availability flag
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

/**
 * Ensure required Ollama models are available.
 */
export async function ensureOllamaModels(): Promise<void> {
  const health = await checkOllamaHealth()

  if (!health.available) {
    logger.warn("Ollama not available, skipping model pull")
    return
  }

  // Ensure classification model
  if (!health.classificationModelLoaded) {
    logger.info({ model: CLASSIFICATION_MODEL }, "Pulling classification model...")
    try {
      await ollama.pull({ model: CLASSIFICATION_MODEL })
      logger.info({ model: CLASSIFICATION_MODEL }, "Classification model pulled successfully")
    } catch (err) {
      logger.error({ err, model: CLASSIFICATION_MODEL }, "Failed to pull classification model")
    }
  }

  // Ensure embedding model
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
 * Used for cost tracking even though local models are "free".
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export interface EngagementCheckResult {
  isDirectedAtAriadne: boolean
  topicChanged: boolean
  confident: boolean
  rawResponse: string
}

/**
 * Check if a message in a conversation is directed at Ariadne.
 * Used to determine if Ariadne should respond to follow-up messages
 * in threads/channels where she's already participated.
 *
 * @param message - The new message to check
 * @param recentContext - Recent messages for context (last few exchanges)
 * @param ariadneLastResponse - Ariadne's most recent response in this thread
 */
export async function checkAriadneEngagement(
  message: string,
  recentContext: string,
  ariadneLastResponse?: string,
): Promise<EngagementCheckResult> {
  try {
    const contextSection = ariadneLastResponse
      ? `Ariadne's last response:
${ariadneLastResponse.slice(0, 500)}

Recent conversation:
${recentContext.slice(0, 1000)}`
      : `Recent conversation:
${recentContext.slice(0, 1000)}`

    const response = await ollama.generate({
      model: CLASSIFICATION_MODEL,
      prompt: `You are analyzing a conversation where an AI assistant named Ariadne has been participating.
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

Then briefly explain why in one sentence.`,
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

    return {
      isDirectedAtAriadne: isDirected,
      topicChanged,
      confident,
      rawResponse: text,
    }
  } catch (err) {
    logger.error({ err, model: CLASSIFICATION_MODEL }, "Ariadne engagement check failed")
    // On error, assume directed to avoid missing legitimate follow-ups
    return { isDirectedAtAriadne: true, topicChanged: false, confident: false, rawResponse: "" }
  }
}
