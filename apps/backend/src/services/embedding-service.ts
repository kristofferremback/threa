import type { AI, CostContext } from "../lib/ai/ai"

const DEFAULT_MODEL = "openrouter:openai/text-embedding-3-small"

export interface EmbeddingServiceConfig {
  ai: AI
  model?: string
}

/** Optional context for cost tracking */
export interface EmbeddingContext {
  workspaceId: string
  userId?: string
}

/** Interface for embedding service implementations */
export interface EmbeddingServiceLike {
  embed(text: string, context?: EmbeddingContext): Promise<number[]>
  embedBatch(texts: string[], context?: EmbeddingContext): Promise<number[][]>
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
  async embed(text: string, context?: EmbeddingContext): Promise<number[]> {
    const costContext: CostContext | undefined = context
      ? { workspaceId: context.workspaceId, userId: context.userId, origin: "system" }
      : undefined

    const { value } = await this.ai.embed({
      model: this.modelId,
      value: text,
      telemetry: { functionId: "embedding-single" },
      context: costContext,
    })
    return value
  }

  /**
   * Generate embeddings for multiple texts in a single request.
   */
  async embedBatch(texts: string[], context?: EmbeddingContext): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }

    const costContext: CostContext | undefined = context
      ? { workspaceId: context.workspaceId, userId: context.userId, origin: "system" }
      : undefined

    const { value } = await this.ai.embedMany({
      model: this.modelId,
      values: texts,
      telemetry: { functionId: "embedding-batch", metadata: { count: texts.length } },
      context: costContext,
    })
    return value
  }
}
