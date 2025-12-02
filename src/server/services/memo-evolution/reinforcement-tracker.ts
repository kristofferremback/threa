/**
 * Reinforcement Tracker
 *
 * Tracks memo reinforcements and calculates effective strength
 * with recency-based decay.
 */

import { Pool } from "pg"
import { sql } from "../../lib/db"
import { logger } from "../../lib/logger"
import type { MemoReinforcement, ReinforcementType, EffectiveStrength } from "./types"

// Decay configuration
const DECAY_RATE_PER_MONTH = 0.1 // 10% decay per month
const REINFORCEMENT_BOOST = 0.05 // Each reinforcement adds up to 5% confidence
const RECENCY_BONUS_7_DAYS = 0.1 // Bonus for activity in last 7 days
const RECENCY_BONUS_30_DAYS = 0.05 // Bonus for activity in last 30 days

export class ReinforcementTracker {
  constructor(private pool: Pool) {}

  /**
   * Record a new reinforcement for a memo.
   */
  async addReinforcement(params: {
    memoId: string
    eventId: string
    type: ReinforcementType
    similarity: number | null
    llmVerified: boolean
  }): Promise<MemoReinforcement> {
    const { memoId, eventId, type, similarity, llmVerified } = params

    // Insert reinforcement record
    const result = await this.pool.query<{
      id: string
      created_at: Date
      weight: number
    }>(
      sql`INSERT INTO memo_reinforcements (memo_id, event_id, reinforcement_type, similarity_score, llm_verified)
          VALUES (${memoId}, ${eventId}, ${type}, ${similarity}, ${llmVerified})
          ON CONFLICT (memo_id, event_id) DO UPDATE
          SET similarity_score = COALESCE(EXCLUDED.similarity_score, memo_reinforcements.similarity_score),
              llm_verified = EXCLUDED.llm_verified OR memo_reinforcements.llm_verified
          RETURNING id, created_at, weight`,
    )

    // Update memo reinforcement count and last_reinforced_at
    await this.pool.query(
      sql`UPDATE memos
          SET reinforcement_count = reinforcement_count + 1,
              last_reinforced_at = NOW(),
              confidence = LEAST(confidence + ${REINFORCEMENT_BOOST}, 1.0),
              updated_at = NOW()
          WHERE id = ${memoId}`,
    )

    logger.info(
      { memoId, eventId, type, similarity, llmVerified },
      "Recorded memo reinforcement",
    )

    return {
      id: result.rows[0].id,
      memoId,
      eventId,
      reinforcementType: type,
      similarityScore: similarity,
      llmVerified,
      createdAt: result.rows[0].created_at.toISOString(),
      weight: result.rows[0].weight,
    }
  }

  /**
   * Get all reinforcements for a memo.
   */
  async getReinforcementsForMemo(memoId: string): Promise<MemoReinforcement[]> {
    const result = await this.pool.query<{
      id: string
      memo_id: string
      event_id: string
      reinforcement_type: string
      similarity_score: number | null
      llm_verified: boolean
      created_at: Date
      weight: number
    }>(
      sql`SELECT id, memo_id, event_id, reinforcement_type, similarity_score,
                 llm_verified, created_at, weight
          FROM memo_reinforcements
          WHERE memo_id = ${memoId}
          ORDER BY created_at DESC`,
    )

    return result.rows.map((row) => ({
      id: row.id,
      memoId: row.memo_id,
      eventId: row.event_id,
      reinforcementType: row.reinforcement_type as ReinforcementType,
      similarityScore: row.similarity_score,
      llmVerified: row.llm_verified,
      createdAt: row.created_at.toISOString(),
      weight: row.weight,
    }))
  }

  /**
   * Calculate effective strength of a memo considering recency decay.
   */
  async calculateEffectiveStrength(memoId: string): Promise<EffectiveStrength> {
    // Get memo base confidence and last reinforced
    const memoResult = await this.pool.query<{
      confidence: number
      last_reinforced_at: Date | null
    }>(
      sql`SELECT confidence, last_reinforced_at FROM memos WHERE id = ${memoId}`,
    )

    if (memoResult.rows.length === 0) {
      return { baseConfidence: 0, reinforcementBoost: 0, recencyBonus: 0, total: 0 }
    }

    const { confidence: baseConfidence, last_reinforced_at } = memoResult.rows[0]

    // Get reinforcements with decayed weights
    const reinforcements = await this.pool.query<{
      weight: number
      months_old: number
    }>(
      sql`SELECT weight,
                 EXTRACT(EPOCH FROM (NOW() - created_at)) / (30 * 24 * 60 * 60) as months_old
          FROM memo_reinforcements
          WHERE memo_id = ${memoId}`,
    )

    // Calculate decayed reinforcement boost
    const reinforcementBoost = reinforcements.rows.reduce((sum, r) => {
      const decayedWeight = r.weight * Math.exp(-DECAY_RATE_PER_MONTH * r.months_old)
      return sum + decayedWeight * REINFORCEMENT_BOOST
    }, 0)

    // Calculate recency bonus
    let recencyBonus = 0
    if (last_reinforced_at) {
      const daysSinceReinforced =
        (Date.now() - last_reinforced_at.getTime()) / (1000 * 60 * 60 * 24)
      if (daysSinceReinforced < 7) {
        recencyBonus = RECENCY_BONUS_7_DAYS
      } else if (daysSinceReinforced < 30) {
        recencyBonus = RECENCY_BONUS_30_DAYS
      }
    }

    const total = Math.min(1.0, baseConfidence + reinforcementBoost + recencyBonus)

    return { baseConfidence, reinforcementBoost, recencyBonus, total }
  }

  /**
   * Check if an event already reinforces any memo.
   */
  async isEventAlreadyReinforcing(eventId: string): Promise<string | null> {
    const result = await this.pool.query<{ memo_id: string }>(
      sql`SELECT memo_id FROM memo_reinforcements WHERE event_id = ${eventId} LIMIT 1`,
    )
    return result.rows[0]?.memo_id ?? null
  }
}
