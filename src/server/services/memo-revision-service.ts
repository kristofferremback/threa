import { Pool } from "pg"
import { sql } from "../lib/db"
import { logger } from "../lib/logger"
import { generateEmbedding } from "../lib/ai-providers"
import { getMemoEmbeddingTable } from "../lib/embedding-tables"
import { Memo, MemoService } from "./memo-service"
import { MemoCategory } from "../lib/ollama"

/**
 * MemoRevisionService - Handles knowledge overlap detection and revision.
 *
 * When new memo-worthy content is detected, this service checks for semantic
 * overlap with existing memos and determines the appropriate action:
 * - Create new memo (no significant overlap)
 * - Merge into existing memo (related content, add as anchor)
 * - Supersede existing memo (newer/better version of same info)
 * - Skip (duplicate or existing memo is higher quality)
 */

export type RevisionAction = "create_new" | "merge" | "supersede" | "skip"

export interface OverlappingMemo {
  memo: Memo
  similarity: number
  isMoreRecent: boolean
}

export interface OverlapResult {
  found: boolean
  overlappingMemos: OverlappingMemo[]
  recommendedAction: RevisionAction
  targetMemoId?: string
  reason: string
}

export class MemoRevisionService {
  private embeddingTable: string
  private memoService: MemoService

  constructor(private pool: Pool) {
    this.embeddingTable = getMemoEmbeddingTable()
    this.memoService = new MemoService(pool)
  }

  /**
   * Find semantically overlapping memos for the given content.
   */
  async findOverlappingMemos(workspaceId: string, content: string, newEventId: string): Promise<OverlapResult> {
    // Generate embedding for new content
    const embeddingResult = await generateEmbedding(content.slice(0, 2000))
    const embeddingJson = JSON.stringify(embeddingResult.embedding)

    // Find semantically similar memos (similarity > 0.75)
    const similar = await this.pool.query<{
      id: string
      workspace_id: string
      summary: string
      topics: string[]
      category: string | null
      anchor_event_ids: string[]
      context_stream_id: string | null
      confidence: number
      retrieval_count: number
      last_retrieved_at: Date | null
      source: string
      created_at: Date
      updated_at: Date
      similarity: number
    }>(
      sql`SELECT m.id, m.workspace_id, m.summary, m.topics, m.category, m.anchor_event_ids,
          m.context_stream_id, m.confidence, m.retrieval_count, m.last_retrieved_at,
          m.source, m.created_at, m.updated_at,
          1 - (emb.embedding <=> ${embeddingJson}::vector) as similarity
        FROM memos m
        INNER JOIN ${sql.raw(this.embeddingTable)} emb ON emb.memo_id = m.id
        WHERE m.workspace_id = ${workspaceId}
          AND m.archived_at IS NULL
          AND 1 - (emb.embedding <=> ${embeddingJson}::vector) > 0.75
        ORDER BY similarity DESC
        LIMIT 5`,
    )

    if (similar.rows.length === 0) {
      logger.debug({ workspaceId }, "No overlapping memos found")
      return {
        found: false,
        overlappingMemos: [],
        recommendedAction: "create_new",
        reason: "No semantically similar memos found",
      }
    }

    // Get current event timestamp for recency comparison
    const eventResult = await this.pool.query<{ created_at: Date }>(
      sql`SELECT created_at FROM stream_events WHERE id = ${newEventId}`,
    )
    const newEventTime = eventResult.rows[0]?.created_at || new Date()

    const overlappingMemos: OverlappingMemo[] = similar.rows.map((row) => ({
      memo: {
        id: row.id,
        workspaceId: row.workspace_id,
        summary: row.summary,
        topics: row.topics || [],
        category: row.category as MemoCategory | null,
        anchorEventIds: row.anchor_event_ids || [],
        contextStreamId: row.context_stream_id,
        contextStartEventId: null,
        contextEndEventId: null,
        participantIds: [],
        primaryAnswererId: null,
        confidence: row.confidence,
        retrievalCount: row.retrieval_count,
        lastRetrievedAt: row.last_retrieved_at?.toISOString() || null,
        helpfulnessScore: 0,
        source: row.source as "user" | "system" | "ariadne",
        createdBy: null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        visibility: "workspace" as const,
        visibleToStreamIds: [],
        archivedAt: null,
      },
      similarity: row.similarity,
      isMoreRecent: newEventTime > row.created_at,
    }))

    // Determine recommended action
    const action = this.determineAction(overlappingMemos)

    logger.debug(
      {
        workspaceId,
        overlapCount: overlappingMemos.length,
        topSimilarity: overlappingMemos[0]?.similarity,
        recommendedAction: action.action,
      },
      "Overlap analysis complete",
    )

    return {
      found: true,
      overlappingMemos,
      recommendedAction: action.action,
      targetMemoId: action.targetMemoId,
      reason: action.reason,
    }
  }

  /**
   * Determine the best action based on overlap analysis.
   */
  private determineAction(overlaps: OverlappingMemo[]): {
    action: RevisionAction
    targetMemoId?: string
    reason: string
  } {
    const mostSimilar = overlaps[0]

    // Very high similarity (>0.92) - likely duplicate or update
    if (mostSimilar.similarity > 0.92) {
      // If new content is more recent, consider superseding
      if (mostSimilar.isMoreRecent && mostSimilar.memo.source === "system") {
        // Only supersede system-generated memos, not user-created ones
        if (mostSimilar.memo.confidence < 0.7) {
          return {
            action: "supersede",
            targetMemoId: mostSimilar.memo.id,
            reason: `Very high similarity (${(mostSimilar.similarity * 100).toFixed(1)}%) with lower-confidence memo, superseding`,
          }
        }
      }

      // High-confidence existing memo or user-created - skip
      return {
        action: "skip",
        targetMemoId: mostSimilar.memo.id,
        reason: `Very high similarity (${(mostSimilar.similarity * 100).toFixed(1)}%) with existing memo, skipping duplicate`,
      }
    }

    // High similarity (0.82-0.92) - related content, merge
    if (mostSimilar.similarity > 0.82) {
      // Don't merge into user-created memos without explicit action
      if (mostSimilar.memo.source === "user") {
        return {
          action: "create_new",
          reason: `High similarity (${(mostSimilar.similarity * 100).toFixed(1)}%) but existing memo is user-created, creating new`,
        }
      }

      return {
        action: "merge",
        targetMemoId: mostSimilar.memo.id,
        reason: `High similarity (${(mostSimilar.similarity * 100).toFixed(1)}%) - merging as additional anchor`,
      }
    }

    // Moderate similarity (0.75-0.82) - create new, they're related but distinct
    return {
      action: "create_new",
      reason: `Moderate similarity (${(mostSimilar.similarity * 100).toFixed(1)}%) - creating new memo for distinct content`,
    }
  }

  /**
   * Supersede an old memo with new content.
   * Archives the old memo and creates a new one.
   */
  async supersedeMemo(
    oldMemoId: string,
    params: {
      workspaceId: string
      anchorEventIds: string[]
      streamId: string
      summary?: string
      topics?: string[]
      category?: MemoCategory
      confidence?: number
    },
  ): Promise<Memo> {
    // Archive old memo with supersession metadata
    await this.pool.query(
      sql`UPDATE memos
        SET archived_at = NOW(),
            updated_at = NOW()
        WHERE id = ${oldMemoId}`,
    )

    logger.info({ oldMemoId }, "Superseded old memo")

    // Create new memo
    return this.memoService.createMemo({
      workspaceId: params.workspaceId,
      anchorEventIds: params.anchorEventIds,
      streamId: params.streamId,
      source: "system",
      summary: params.summary,
      topics: params.topics,
      category: params.category,
      confidence: params.confidence ?? 0.6,
    })
  }

  /**
   * Merge new content into an existing memo by adding a new anchor.
   */
  async mergeMemo(existingMemoId: string, newEventId: string, confidenceBoost: number = 0.05): Promise<void> {
    await this.pool.query(
      sql`UPDATE memos
        SET anchor_event_ids = array_append(anchor_event_ids, ${newEventId}),
            confidence = LEAST(confidence + ${confidenceBoost}, 1.0),
            updated_at = NOW()
        WHERE id = ${existingMemoId}
          AND NOT ${newEventId} = ANY(anchor_event_ids)`,
    )

    logger.info({ memoId: existingMemoId, newEventId }, "Merged event into existing memo")
  }
}
