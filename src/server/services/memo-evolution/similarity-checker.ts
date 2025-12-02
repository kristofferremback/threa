/**
 * Similarity Checker
 *
 * Handles finding similar memos via anchor event embeddings
 * and LLM verification for borderline cases.
 */

import { Pool } from "pg"
import ollama from "ollama"
import { sql } from "../../lib/db"
import { logger } from "../../lib/logger"
import { getEventEmbeddingTable } from "../../lib/embedding-tables"
import type { SimilarAnchorMatch, LLMVerification, EvolutionDecision } from "./types"

// Thresholds for similarity-based decisions
const SIMILARITY_THRESHOLD_LOW = 0.65 // Minimum to consider as potential match
const SIMILARITY_THRESHOLD_HIGH = 0.85 // High enough to trust without LLM

export class SimilarityChecker {
  private embeddingTable: string

  constructor(private pool: Pool) {
    this.embeddingTable = getEventEmbeddingTable()
  }

  /**
   * Find memos with similar anchor events to the given event.
   * Uses event-to-event embedding comparison for consistency.
   */
  async findSimilarMemos(workspaceId: string, eventId: string): Promise<SimilarAnchorMatch[]> {
    // Get the embedding for the new event
    const eventEmbedding = await this.pool.query<{ embedding: string }>(
      sql`SELECT embedding::text FROM ${sql.raw(this.embeddingTable)}
          WHERE event_id = ${eventId}`,
    )

    if (eventEmbedding.rows.length === 0) {
      logger.debug({ eventId }, "No embedding found for event, skipping similarity check")
      return []
    }

    const embedding = eventEmbedding.rows[0].embedding

    // Find similar anchor events across all memos
    const similar = await this.pool.query<{
      memo_id: string
      anchor_event_id: string
      similarity: number
      summary: string
      confidence: number
      source: string
      created_at: Date
    }>(
      sql`SELECT DISTINCT ON (m.id)
            m.id as memo_id,
            anchor_id as anchor_event_id,
            1 - (emb.embedding <=> ${embedding}::vector) as similarity,
            m.summary,
            m.confidence,
            m.source,
            m.created_at
          FROM memos m
          CROSS JOIN UNNEST(m.anchor_event_ids) as anchor_id
          INNER JOIN ${sql.raw(this.embeddingTable)} emb ON emb.event_id = anchor_id
          WHERE m.workspace_id = ${workspaceId}
            AND m.archived_at IS NULL
            AND anchor_id != ${eventId}
            AND 1 - (emb.embedding <=> ${embedding}::vector) > ${SIMILARITY_THRESHOLD_LOW}
          ORDER BY m.id, similarity DESC`,
    )

    return similar.rows.map((row) => ({
      memoId: row.memo_id,
      eventId: row.anchor_event_id,
      similarity: row.similarity,
      memoSummary: row.summary,
      memoConfidence: row.confidence,
      memoSource: row.source as "user" | "system" | "ariadne",
      memoCreatedAt: row.created_at.toISOString(),
    }))
  }

  /**
   * Determine the evolution action based on similarity matches.
   * Uses LLM verification for borderline cases.
   */
  async determineAction(
    newContent: string,
    matches: SimilarAnchorMatch[],
    isMoreRecent: boolean,
  ): Promise<EvolutionDecision> {
    if (matches.length === 0) {
      return {
        action: "create_new",
        similarity: 0,
        reasoning: "No similar memos found",
        llmVerified: false,
      }
    }

    // Sort by similarity, take the best match
    const sortedMatches = [...matches].sort((a, b) => b.similarity - a.similarity)
    const bestMatch = sortedMatches[0]

    // High similarity - trust embeddings
    if (bestMatch.similarity > SIMILARITY_THRESHOLD_HIGH) {
      // Check if we should supersede or skip
      if (isMoreRecent && bestMatch.memoSource === "system" && bestMatch.memoConfidence < 0.7) {
        return {
          action: "supersede",
          targetMemoId: bestMatch.memoId,
          similarity: bestMatch.similarity,
          reasoning: `High similarity (${(bestMatch.similarity * 100).toFixed(1)}%) with low-confidence memo, superseding`,
          llmVerified: false,
        }
      }

      // Reinforce existing memo
      return {
        action: "reinforce",
        targetMemoId: bestMatch.memoId,
        similarity: bestMatch.similarity,
        reasoning: `High similarity (${(bestMatch.similarity * 100).toFixed(1)}%), reinforcing existing memo`,
        llmVerified: false,
      }
    }

    // Borderline similarity - use LLM to verify
    const verification = await this.verifyWithLLM(newContent, bestMatch.memoSummary)

    if (verification.isSameTopic) {
      // Don't merge into user-created memos
      if (bestMatch.memoSource === "user") {
        return {
          action: "create_new",
          similarity: bestMatch.similarity,
          reasoning: `LLM confirmed same topic but existing memo is user-created, creating new`,
          llmVerified: true,
        }
      }

      return {
        action: "reinforce",
        targetMemoId: bestMatch.memoId,
        similarity: bestMatch.similarity,
        reasoning: `LLM verified same topic (${verification.relationship}): ${verification.explanation}`,
        llmVerified: true,
      }
    }

    // LLM says different topic
    return {
      action: "create_new",
      similarity: bestMatch.similarity,
      reasoning: `LLM determined different topic: ${verification.explanation}`,
      llmVerified: true,
    }
  }

  /**
   * Use LLM to verify if two pieces of content are about the same topic.
   */
  async verifyWithLLM(newContent: string, existingSummary: string): Promise<LLMVerification> {
    const prompt = `Compare these two pieces of content and determine if they're about the same topic.

EXISTING MEMO SUMMARY:
${existingSummary}

NEW MESSAGE:
${newContent.slice(0, 1000)}

Respond with JSON only (no markdown):
{"same_topic": boolean, "relationship": "identical" | "same_topic" | "related" | "different", "explanation": "brief reasoning (max 50 words)"}

Guidelines:
- "identical": Essentially the same information
- "same_topic": About the same subject, may add new details
- "related": Connected but discussing distinct aspects
- "different": Unrelated topics`

    try {
      const response = await ollama.chat({
        model: "llama3.2:3b",
        messages: [{ role: "user", content: prompt }],
        options: { temperature: 0.1 },
      })

      const content = response.message.content.trim()

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        logger.warn({ content }, "LLM response not valid JSON, defaulting to different")
        return { isSameTopic: false, relationship: "different", explanation: "Failed to parse LLM response" }
      }

      const parsed = JSON.parse(jsonMatch[0])
      return {
        isSameTopic: parsed.same_topic === true,
        relationship: parsed.relationship || "different",
        explanation: parsed.explanation || "",
      }
    } catch (err) {
      logger.error({ err }, "LLM verification failed, defaulting to create_new")
      return { isSameTopic: false, relationship: "different", explanation: "LLM verification failed" }
    }
  }
}
