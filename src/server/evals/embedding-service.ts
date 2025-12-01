/**
 * Embedding service for evals.
 *
 * Generates real embeddings using Ollama or OpenAI.
 */

import ollama from "ollama"
import { OLLAMA_EMBEDDING_MODEL, OLLAMA_HOST } from "../config"

export interface EmbeddingResult {
  embedding: number[]
  model: string
  latencyMs: number
}

/**
 * Generate embeddings using Ollama.
 */
export async function generateEmbedding(content: string): Promise<EmbeddingResult> {
  const start = performance.now()

  const response = await ollama.embed({
    model: OLLAMA_EMBEDDING_MODEL,
    input: content,
  })

  const latencyMs = performance.now() - start

  return {
    embedding: response.embeddings[0],
    model: OLLAMA_EMBEDDING_MODEL,
    latencyMs,
  }
}

/**
 * Calculate cosine similarity between two embedding vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }

  let dotProduct = 0
  let magnitudeA = 0
  let magnitudeB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    magnitudeA += a[i] * a[i]
    magnitudeB += b[i] * b[i]
  }

  return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB))
}
