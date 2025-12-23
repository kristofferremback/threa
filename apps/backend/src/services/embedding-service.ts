import { embed, embedMany, type EmbeddingModel } from "ai"
import type { ProviderRegistry } from "../lib/ai"

const DEFAULT_MODEL = "openrouter:openai/text-embedding-3-small"

export interface EmbeddingServiceConfig {
  providerRegistry: ProviderRegistry
  model?: string
}

/**
 * Service for generating embeddings using the configured provider.
 * Wraps ProviderRegistry with a configured default model.
 */
export class EmbeddingService {
  private embeddingModel: EmbeddingModel<string>

  constructor(config: EmbeddingServiceConfig) {
    const model = config.model ?? DEFAULT_MODEL
    this.embeddingModel = config.providerRegistry.getEmbeddingModel(model)
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<number[]> {
    const result = await embed({ model: this.embeddingModel, value: text })
    return result.embedding
  }

  /**
   * Generate embeddings for multiple texts in a single request.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }
    const result = await embedMany({ model: this.embeddingModel, values: texts })
    return result.embeddings
  }
}
