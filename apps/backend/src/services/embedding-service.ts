import { logger } from "../lib/logger"

const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings"
const DEFAULT_MODEL = "openai/text-embedding-3-small"

interface EmbeddingResponse {
  data: Array<{
    embedding: number[]
    index: number
  }>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}

export interface EmbeddingServiceConfig {
  apiKey: string
  model?: string
}

export class EmbeddingService {
  private apiKey: string
  private model: string

  constructor(config: EmbeddingServiceConfig) {
    this.apiKey = config.apiKey
    this.model = config.model ?? DEFAULT_MODEL
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<number[]> {
    const embeddings = await this.embedBatch([text])
    return embeddings[0]
  }

  /**
   * Generate embeddings for multiple texts in a single request.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }

    try {
      const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://threa.app",
          "X-Title": "Threa",
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error({ status: response.status, error: errorText }, "OpenRouter embedding request failed")
        throw new Error(`OpenRouter embedding request failed: ${response.status} - ${errorText}`)
      }

      const data = (await response.json()) as EmbeddingResponse

      // Sort by index to ensure correct order
      const sorted = data.data.sort((a, b) => a.index - b.index)
      return sorted.map((item) => item.embedding)
    } catch (error) {
      logger.error({ error, model: this.model }, "Failed to generate embeddings")
      throw error
    }
  }
}
