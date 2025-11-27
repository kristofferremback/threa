import ollama from "ollama"
import { logger } from "./logger"

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434"
const CLASSIFICATION_MODEL = process.env.OLLAMA_CLASSIFICATION_MODEL || "granite4:350m"

export interface ClassificationResult {
  isKnowledge: boolean
  confident: boolean
  rawResponse: string
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
 * Check if Ollama is available and the classification model is loaded.
 */
export async function checkOllamaHealth(): Promise<{
  available: boolean
  modelLoaded: boolean
  error?: string
}> {
  try {
    const models = await ollama.list()
    const modelLoaded = models.models.some(
      (m) => m.name === CLASSIFICATION_MODEL || m.name.startsWith(CLASSIFICATION_MODEL.split(":")[0]),
    )

    return { available: true, modelLoaded }
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error"
    logger.warn({ err, host: OLLAMA_HOST }, "Ollama health check failed")
    return { available: false, modelLoaded: false, error }
  }
}

/**
 * Pull the classification model if not already available.
 */
export async function ensureClassificationModel(): Promise<void> {
  const health = await checkOllamaHealth()

  if (!health.available) {
    logger.warn("Ollama not available, skipping model pull")
    return
  }

  if (!health.modelLoaded) {
    logger.info({ model: CLASSIFICATION_MODEL }, "Pulling classification model...")
    try {
      await ollama.pull({ model: CLASSIFICATION_MODEL })
      logger.info({ model: CLASSIFICATION_MODEL }, "Classification model pulled successfully")
    } catch (err) {
      logger.error({ err, model: CLASSIFICATION_MODEL }, "Failed to pull classification model")
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
