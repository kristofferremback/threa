/**
 * Memo Evolution Types
 *
 * Shared types for the memo evolution system.
 */

export type ReinforcementType = "original" | "merge" | "thread_update"

export type EvolutionAction = "create_new" | "reinforce" | "supersede" | "skip"

export type SemanticRelationship = "identical" | "same_topic" | "related" | "different"

export interface MemoReinforcement {
  id: string
  memoId: string
  eventId: string
  reinforcementType: ReinforcementType
  similarityScore: number | null
  llmVerified: boolean
  createdAt: string
  weight: number
}

export interface SimilarAnchorMatch {
  memoId: string
  eventId: string
  similarity: number
  memoSummary: string
  memoConfidence: number
  memoSource: "user" | "system" | "ariadne"
  memoCreatedAt: string
}

export interface EvolutionDecision {
  action: EvolutionAction
  targetMemoId?: string
  similarity: number
  reasoning: string
  llmVerified: boolean
}

export interface LLMVerification {
  isSameTopic: boolean
  relationship: SemanticRelationship
  explanation: string
}

export interface EffectiveStrength {
  baseConfidence: number
  reinforcementBoost: number
  recencyBonus: number
  total: number
}
