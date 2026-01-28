/**
 * Semantic search configuration.
 *
 * Single source of truth for relevance thresholds used by memo and message
 * semantic search (API and agent tools). Only results within the threshold
 * are returned; others are filtered out to reduce noise and cost.
 *
 * pgvector uses L2 distance: lower = more similar. Threshold is max distance
 * to consider a result relevant (e.g. 0.8 = exclude results farther than 0.8).
 */

/** Max L2 distance to consider a memo or message semantically relevant. Results beyond this are excluded. */
export const SEMANTIC_DISTANCE_THRESHOLD = 0.8
