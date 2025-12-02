/**
 * Embedding table selection based on provider.
 *
 * Uses environment variable EMBEDDING_PROVIDER to determine which table to use:
 * - "ollama" (default): Uses 768-dim tables (embeddings_768, memo_embeddings_768)
 * - "openai": Uses 1536-dim tables (embeddings_1536, memo_embeddings_1536)
 */

import { EMBEDDING_PROVIDER } from "../config"

export type EmbeddingProvider = "ollama" | "openai"

export function getEmbeddingProvider(): EmbeddingProvider {
  return EMBEDDING_PROVIDER
}

export function getEmbeddingDimension(): 768 | 1536 {
  return EMBEDDING_PROVIDER === "openai" ? 1536 : 768
}

export function getTextMessageEmbeddingTable(): "embeddings_768" | "embeddings_1536" {
  return EMBEDDING_PROVIDER === "openai" ? "embeddings_1536" : "embeddings_768"
}

export function getMemoEmbeddingTable(): "memo_embeddings_768" | "memo_embeddings_1536" {
  return EMBEDDING_PROVIDER === "openai" ? "memo_embeddings_1536" : "memo_embeddings_768"
}

export function getEventEmbeddingTable(): "event_embeddings_768" | "event_embeddings_1536" {
  return EMBEDDING_PROVIDER === "openai" ? "event_embeddings_1536" : "event_embeddings_768"
}

/**
 * Get the SQL table name for text message embeddings (for dynamic queries).
 */
export function textMessageEmbeddingsSql(): string {
  return getTextMessageEmbeddingTable()
}

/**
 * Get the SQL table name for memo embeddings (for dynamic queries).
 */
export function memoEmbeddingsSql(): string {
  return getMemoEmbeddingTable()
}
