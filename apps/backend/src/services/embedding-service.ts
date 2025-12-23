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
  private providerRegistry: ProviderRegistry
  private model: string

  constructor(config: EmbeddingServiceConfig) {
    this.providerRegistry = config.providerRegistry
    this.model = config.model ?? DEFAULT_MODEL
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<number[]> {
    return this.providerRegistry.embed(this.model, text)
  }

  /**
   * Generate embeddings for multiple texts in a single request.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.providerRegistry.embedBatch(this.model, texts)
  }
}
