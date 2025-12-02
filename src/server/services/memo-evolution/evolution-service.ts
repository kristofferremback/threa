/**
 * Memo Evolution Service
 *
 * Main orchestrator for memo evolution logic.
 * Handles evaluating new content for evolution decisions.
 */

import { Pool } from "pg"
import { sql } from "../../lib/db"
import { logger } from "../../lib/logger"
import { SimilarityChecker } from "./similarity-checker"
import { ReinforcementTracker } from "./reinforcement-tracker"
import type { EvolutionDecision, EffectiveStrength } from "./types"

export class MemoEvolutionService {
  private similarityChecker: SimilarityChecker
  private reinforcementTracker: ReinforcementTracker

  constructor(private pool: Pool) {
    this.similarityChecker = new SimilarityChecker(pool)
    this.reinforcementTracker = new ReinforcementTracker(pool)
  }

  /**
   * Evaluate a new event for memo evolution.
   * Returns a decision on whether to create new, reinforce, supersede, or skip.
   */
  async evaluateForEvolution(
    workspaceId: string,
    eventId: string,
    content: string,
  ): Promise<EvolutionDecision> {
    // Check if this event already reinforces a memo
    const existingMemoId = await this.reinforcementTracker.isEventAlreadyReinforcing(eventId)
    if (existingMemoId) {
      logger.debug({ eventId, existingMemoId }, "Event already reinforces a memo, skipping")
      return {
        action: "skip",
        targetMemoId: existingMemoId,
        similarity: 1.0,
        reasoning: "Event already reinforces an existing memo",
        llmVerified: false,
      }
    }

    // Get event creation time for recency comparison
    const eventResult = await this.pool.query<{ created_at: Date }>(
      sql`SELECT created_at FROM stream_events WHERE id = ${eventId}`,
    )
    const eventTime = eventResult.rows[0]?.created_at || new Date()

    // Find similar memos via anchor event embeddings
    const similarMemos = await this.similarityChecker.findSimilarMemos(workspaceId, eventId)

    if (similarMemos.length === 0) {
      return {
        action: "create_new",
        similarity: 0,
        reasoning: "No similar memos found",
        llmVerified: false,
      }
    }

    // Check recency relative to best match
    const bestMatch = similarMemos[0]
    const isMoreRecent = eventTime > new Date(bestMatch.memoCreatedAt)

    // Determine action based on similarity and LLM verification
    return await this.similarityChecker.determineAction(content, similarMemos, isMoreRecent)
  }

  /**
   * Reinforce a memo with a new event.
   */
  async reinforceMemo(
    memoId: string,
    eventId: string,
    similarity: number,
    llmVerified: boolean,
  ): Promise<void> {
    // Add to anchor_event_ids if not already there
    await this.pool.query(
      sql`UPDATE memos
          SET anchor_event_ids = array_append(anchor_event_ids, ${eventId}),
              updated_at = NOW()
          WHERE id = ${memoId}
            AND NOT ${eventId} = ANY(anchor_event_ids)`,
    )

    // Record the reinforcement
    await this.reinforcementTracker.addReinforcement({
      memoId,
      eventId,
      type: "merge",
      similarity,
      llmVerified,
    })

    logger.info(
      { memoId, eventId, similarity, llmVerified },
      "🔗 Reinforced memo with new event",
    )
  }

  /**
   * Get effective strength of a memo.
   */
  async getEffectiveStrength(memoId: string): Promise<EffectiveStrength> {
    return this.reinforcementTracker.calculateEffectiveStrength(memoId)
  }

  /**
   * Record an original anchor (when memo is first created).
   */
  async recordOriginalAnchor(memoId: string, eventId: string): Promise<void> {
    await this.reinforcementTracker.addReinforcement({
      memoId,
      eventId,
      type: "original",
      similarity: 1.0,
      llmVerified: false,
    })
  }
}
