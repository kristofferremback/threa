import type { AI } from "../lib/ai/ai"

const DEFAULT_MODEL = "openrouter:openai/text-embedding-3-small"

export interface EmbeddingServiceConfig {
  ai: AI
  model?: string
}

/** Interface for embedding service implementations */
export interface EmbeddingServiceLike {
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}

/**
 * Service for generating embeddings using the configured provider.
 * Wraps AI with a configured default model.
 */
export class EmbeddingService implements EmbeddingServiceLike {
  private ai: AI
  private modelId: string

  constructor(config: EmbeddingServiceConfig) {
    this.ai = config.ai
    this.modelId = config.model ?? DEFAULT_MODEL
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<number[]> {
    const { value } = await this.ai.embed({
      model: this.modelId,
      value: text,
      telemetry: { functionId: "embedding-single" },
    })
    return value
  }

  /**
   * Generate embeddings for multiple texts in a single request.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }
    const { value } = await this.ai.embedMany({
      model: this.modelId,
      values: texts,
      telemetry: { functionId: "embedding-batch", metadata: { count: texts.length } },
    })
    return value
  }
}
