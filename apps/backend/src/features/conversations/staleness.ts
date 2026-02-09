import type { Conversation } from "./repository"

export interface ConversationWithStaleness extends Conversation {
  temporalStaleness: number
  effectiveCompleteness: number
}

/**
 * Compute temporal staleness based on time since last activity.
 * Returns 0-4 scale where 0 = fresh, 4 = very stale.
 *
 * Thresholds:
 * - < 1 hour: 0 (fresh)
 * - < 4 hours: 1 (recent)
 * - < 12 hours: 2 (getting stale)
 * - < 24 hours: 3 (stale)
 * - >= 24 hours: 4 (very stale)
 */
export function computeTemporalStaleness(lastActivityAt: Date): number {
  const hours = (Date.now() - lastActivityAt.getTime()) / (1000 * 60 * 60)
  if (hours < 1) return 0
  if (hours < 4) return 1
  if (hours < 12) return 2
  if (hours < 24) return 3
  return 4
}

/**
 * Combine content-based completeness score with temporal staleness.
 * Effective completeness is capped at 7.
 */
export function computeEffectiveCompleteness(contentScore: number, staleness: number): number {
  return Math.min(7, contentScore + staleness)
}

/**
 * Add computed staleness fields to a conversation.
 */
export function addStalenessFields(conversation: Conversation): ConversationWithStaleness {
  const temporalStaleness = computeTemporalStaleness(conversation.lastActivityAt)
  return {
    ...conversation,
    temporalStaleness,
    effectiveCompleteness: computeEffectiveCompleteness(conversation.completenessScore, temporalStaleness),
  }
}
