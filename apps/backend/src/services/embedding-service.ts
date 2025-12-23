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
 *
 * Uses lazy initialization to avoid failing at startup when API keys
 * aren't configured (e.g., in test environments).
 */
export class EmbeddingService {
  private providerRegistry: ProviderRegistry
  private modelId: string
  private embeddingModel: EmbeddingModel<string> | null = null

  constructor(config: EmbeddingServiceConfig) {
    this.providerRegistry = config.providerRegistry
    this.modelId = config.model ?? DEFAULT_MODEL
  }

  private getModel(): EmbeddingModel<string> {
    if (!this.embeddingModel) {
      this.embeddingModel = this.providerRegistry.getEmbeddingModel(this.modelId)
    }
    return this.embeddingModel
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<number[]> {
    const result = await embed({ model: this.getModel(), value: text })
    return result.embedding
  }

  /**
   * Generate embeddings for multiple texts in a single request.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }
    const result = await embedMany({ model: this.getModel(), values: texts })
    return result.embeddings
  }
}
