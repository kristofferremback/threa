/**
 * Test helpers for memo evolution tests.
 */

import { Pool } from "pg"
import { sql } from "../../../lib/db"
import { getEventEmbeddingTable, getMemoEmbeddingTable, getEmbeddingDimension } from "../../../lib/embedding-tables"
import {
  getTestPool,
  closeTestPool,
  cleanupTestData as baseCleanupTestData,
  createTestUser,
  createTestWorkspace,
  addUserToWorkspace,
  createTestStream,
  createTestMessage,
} from "../../__tests__/test-helpers"

import type { TestUser, TestWorkspace, TestStream, TestEvent } from "../../__tests__/test-helpers"

export {
  getTestPool,
  closeTestPool,
  createTestUser,
  createTestWorkspace,
  addUserToWorkspace,
  createTestStream,
  createTestMessage,
}

export type { TestUser, TestWorkspace, TestStream, TestEvent }

let idCounter = 0
function generateId(prefix: string): string {
  return `${prefix}_evo_test_${++idCounter}_${Date.now()}`
}

/**
 * Extended cleanup that includes memo tables.
 * Uses cascade through base cleanup for most tables.
 */
export async function cleanupTestData(p: Pool): Promise<void> {
  // Clean memo-related data first (uses proper event_embeddings_xxx tables)
  const embeddingTable = getEventEmbeddingTable()
  const memoEmbeddingTable = getMemoEmbeddingTable()

  await p.query("DELETE FROM memo_reinforcements")
  await p.query(sql`DELETE FROM ${sql.raw(memoEmbeddingTable)}`)
  await p.query(sql`DELETE FROM ${sql.raw(embeddingTable)}`)
  await p.query("DELETE FROM memos")
  await baseCleanupTestData(p)
}

export interface TestMemo {
  id: string
  workspaceId: string
  summary: string
  anchorEventIds: string[]
  confidence: number
  source: "user" | "system" | "ariadne"
  createdAt: Date
}

/**
 * Create a test memo with anchor events.
 */
export async function createTestMemo(
  p: Pool,
  workspaceId: string,
  streamId: string,
  anchorEventIds: string[],
  overrides: Partial<Omit<TestMemo, "workspaceId" | "anchorEventIds">> = {},
): Promise<TestMemo> {
  const id = overrides.id || generateId("memo")
  const summary = overrides.summary || `Test memo summary ${id}`
  const confidence = overrides.confidence ?? 0.7
  const source = overrides.source || "system"
  const createdAt = overrides.createdAt || new Date()

  await p.query(
    sql`INSERT INTO memos (id, workspace_id, summary, anchor_event_ids, context_stream_id, confidence, source, created_at, updated_at)
        VALUES (${id}, ${workspaceId}, ${summary}, ${anchorEventIds}, ${streamId}, ${confidence}, ${source}, ${createdAt}, ${createdAt})`,
  )

  return { id, workspaceId, summary, anchorEventIds, confidence, source, createdAt }
}

/**
 * Create a test embedding for an event.
 *
 * Uses a deterministic fake embedding based on content hash for testing.
 * Real tests against actual embeddings would require the embedding service.
 */
export async function createTestEventEmbedding(
  p: Pool,
  eventId: string,
  content: string,
  overrides: { embedding?: number[] } = {},
): Promise<void> {
  const embeddingTable = getEventEmbeddingTable()
  const dimensions = getEmbeddingDimension()
  const model = dimensions === 1536 ? "text-embedding-3-small" : "nomic-embed-text"

  // Generate deterministic fake embedding from content
  // This allows similar content to have similar embeddings for testing
  const embedding = overrides.embedding || generateFakeEmbedding(content, dimensions)
  const embeddingJson = JSON.stringify(embedding)

  await p.query(
    sql`INSERT INTO ${sql.raw(embeddingTable)} (event_id, embedding, model, created_at)
        VALUES (${eventId}, ${embeddingJson}::vector, ${model}, NOW())
        ON CONFLICT (event_id) DO UPDATE SET embedding = ${embeddingJson}::vector`,
  )
}

/**
 * Create a test memo embedding.
 */
export async function createTestMemoEmbedding(
  p: Pool,
  memoId: string,
  content: string,
  overrides: { embedding?: number[] } = {},
): Promise<void> {
  const dimensions = getEmbeddingDimension()
  const embeddingTable = getMemoEmbeddingTable()
  const model = dimensions === 1536 ? "text-embedding-3-small" : "nomic-embed-text"
  const embedding = overrides.embedding || generateFakeEmbedding(content, dimensions)
  const embeddingJson = JSON.stringify(embedding)

  await p.query(
    sql`INSERT INTO ${sql.raw(embeddingTable)} (memo_id, embedding, model, created_at)
        VALUES (${memoId}, ${embeddingJson}::vector, ${model}, NOW())
        ON CONFLICT (memo_id) DO UPDATE SET embedding = ${embeddingJson}::vector`,
  )
}

/**
 * Generate a fake embedding vector for testing.
 *
 * Uses a simple hash-based approach to generate deterministic embeddings.
 * Similar content will produce somewhat similar embeddings.
 */
export function generateFakeEmbedding(content: string, dimensions: number = 768): number[] {
  const embedding: number[] = new Array(dimensions).fill(0)

  // Simple hash-based embedding generation
  const words = content.toLowerCase().split(/\s+/)

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    for (let j = 0; j < word.length; j++) {
      const charCode = word.charCodeAt(j)
      const idx = (charCode * (i + 1) * (j + 1)) % dimensions
      embedding[idx] += 0.1
    }
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
  if (magnitude > 0) {
    for (let i = 0; i < dimensions; i++) {
      embedding[i] /= magnitude
    }
  }

  return embedding
}

/**
 * Create embeddings that have a specific similarity score.
 *
 * This is useful for testing specific similarity thresholds.
 */
export function generateEmbeddingsWithSimilarity(
  baseContent: string,
  targetSimilarity: number,
  dimensions: number = 768,
): { base: number[]; similar: number[] } {
  const base = generateFakeEmbedding(baseContent, dimensions)

  // Generate a random orthogonal vector
  const random: number[] = new Array(dimensions).fill(0).map(() => Math.random() - 0.5)
  const randomMagnitude = Math.sqrt(random.reduce((sum, val) => sum + val * val, 0))
  const normalizedRandom = random.map((v) => v / randomMagnitude)

  // Mix base and random to achieve target similarity
  // similarity = cos(angle) = dot(base, similar) / (|base| * |similar|)
  // Since both are unit vectors: similarity = dot(base, similar)
  // If similar = a * base + b * orthogonal, then similarity = a
  const a = targetSimilarity
  const b = Math.sqrt(1 - a * a)

  const similar = base.map((baseVal, i) => a * baseVal + b * normalizedRandom[i])

  // Normalize
  const similarMagnitude = Math.sqrt(similar.reduce((sum, val) => sum + val * val, 0))
  const normalizedSimilar = similar.map((v) => v / similarMagnitude)

  return { base, similar: normalizedSimilar }
}

/**
 * Calculate cosine similarity between two embedding vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same dimension")
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

/**
 * Create a complete test scenario with workspace, user, stream, memo, and events.
 */
export async function createTestScenario(
  p: Pool,
  options: {
    memoContent?: string
    memoConfidence?: number
    memoSource?: "user" | "system" | "ariadne"
    anchorContents?: string[]
  } = {},
): Promise<{
  workspace: TestWorkspace
  user: TestUser
  stream: TestStream
  memo: TestMemo
  anchorEvents: TestEvent[]
}> {
  const workspace = await createTestWorkspace(p)
  const user = await createTestUser(p)
  await addUserToWorkspace(p, user.id, workspace.id)

  const stream = await createTestStream(p, workspace.id, { visibility: "public" })

  const anchorContents = options.anchorContents || ["Test anchor message content"]
  const anchorEvents: TestEvent[] = []

  for (const content of anchorContents) {
    const event = await createTestMessage(p, stream.id, user.id, content)
    await createTestEventEmbedding(p, event.id, content)
    anchorEvents.push(event)
  }

  const memo = await createTestMemo(p, workspace.id, stream.id, anchorEvents.map((e) => e.id), {
    summary: options.memoContent || "Test memo summary",
    confidence: options.memoConfidence ?? 0.7,
    source: options.memoSource || "system",
  })

  // Create memo embedding from the summary
  await createTestMemoEmbedding(p, memo.id, memo.summary)

  return { workspace, user, stream, memo, anchorEvents }
}

/**
 * Create a new event with embedding in an existing scenario.
 */
export async function addEventToScenario(
  p: Pool,
  scenario: { stream: TestStream; user: TestUser },
  content: string,
  overrides: { embedding?: number[]; createdAt?: Date } = {},
): Promise<TestEvent> {
  const event = await createTestMessage(p, scenario.stream.id, scenario.user.id, content, {
    createdAt: overrides.createdAt,
  })
  await createTestEventEmbedding(p, event.id, content, { embedding: overrides.embedding })
  return event
}

/**
 * Get reinforcements for a memo.
 */
export async function getReinforcementsForMemo(
  p: Pool,
  memoId: string,
): Promise<
  Array<{
    id: string
    eventId: string
    type: string
    similarity: number | null
    llmVerified: boolean
    weight: number
  }>
> {
  const result = await p.query<{
    id: string
    event_id: string
    reinforcement_type: string
    similarity_score: number | null
    llm_verified: boolean
    weight: number
  }>(
    sql`SELECT id, event_id, reinforcement_type, similarity_score, llm_verified, weight
        FROM memo_reinforcements
        WHERE memo_id = ${memoId}
        ORDER BY created_at`,
  )

  return result.rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    type: row.reinforcement_type,
    similarity: row.similarity_score,
    llmVerified: row.llm_verified,
    weight: row.weight,
  }))
}

/**
 * Get memo by ID with full details.
 */
export async function getMemoById(
  p: Pool,
  memoId: string,
): Promise<TestMemo | null> {
  const result = await p.query<{
    id: string
    workspace_id: string
    summary: string
    anchor_event_ids: string[]
    confidence: number
    source: string
    created_at: Date
  }>(
    sql`SELECT id, workspace_id, summary, anchor_event_ids, confidence, source, created_at
        FROM memos
        WHERE id = ${memoId}`,
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    summary: row.summary,
    anchorEventIds: row.anchor_event_ids,
    confidence: row.confidence,
    source: row.source as "user" | "system" | "ariadne",
    createdAt: row.created_at,
  }
}
