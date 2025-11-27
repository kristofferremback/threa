/**
 * Embedding table selection based on provider.
 *
 * Uses environment variable EMBEDDING_PROVIDER to determine which table to use:
 * - "ollama" (default): Uses 768-dim tables (embeddings_768, knowledge_embeddings_768)
 * - "openai": Uses 1536-dim tables (embeddings_1536, knowledge_embeddings_1536)
 */

export type EmbeddingProvider = "ollama" | "openai"

const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || "ollama") as EmbeddingProvider

export function getEmbeddingProvider(): EmbeddingProvider {
  return EMBEDDING_PROVIDER
}

export function getEmbeddingDimension(): 768 | 1536 {
  return EMBEDDING_PROVIDER === "openai" ? 1536 : 768
}

export function getTextMessageEmbeddingTable(): "embeddings_768" | "embeddings_1536" {
  return EMBEDDING_PROVIDER === "openai" ? "embeddings_1536" : "embeddings_768"
}

export function getKnowledgeEmbeddingTable(): "knowledge_embeddings_768" | "knowledge_embeddings_1536" {
  return EMBEDDING_PROVIDER === "openai" ? "knowledge_embeddings_1536" : "knowledge_embeddings_768"
}

/**
 * Get the SQL table name for text message embeddings (for dynamic queries).
 */
export function textMessageEmbeddingsSql(): string {
  return getTextMessageEmbeddingTable()
}

/**
 * Get the SQL table name for knowledge embeddings (for dynamic queries).
 */
export function knowledgeEmbeddingsSql(): string {
  return getKnowledgeEmbeddingTable()
}

