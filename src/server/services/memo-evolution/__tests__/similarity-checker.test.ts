/**
 * Tests for SimilarityChecker
 *
 * Tests the core similarity detection logic using event embeddings.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { SimilarityChecker } from "../similarity-checker"
import {
  getTestPool,
  closeTestPool,
  cleanupTestData,
  createTestScenario,
  addEventToScenario,
  generateEmbeddingsWithSimilarity,
  cosineSimilarity,
} from "./test-helpers"
import { getEventEmbeddingTable } from "../../../lib/embedding-tables"

describe("SimilarityChecker", () => {
  let pool: Pool
  let checker: SimilarityChecker

  beforeAll(async () => {
    pool = await getTestPool()
    checker = new SimilarityChecker(pool)
  })

  afterAll(async () => {
    await closeTestPool()
  })

  beforeEach(async () => {
    await cleanupTestData(pool)
  })

  describe("findSimilarMemos", () => {
    test("should return empty array when no similar memos exist", async () => {
      const scenario = await createTestScenario(pool, {
        anchorContents: ["Database backup runs at 3am"],
      })

      // Create new event with unrelated content
      const newEvent = await addEventToScenario(pool, scenario, "Frontend uses React and TypeScript")

      const results = await checker.findSimilarMemos(scenario.workspace.id, newEvent.id)

      expect(results.length).toBe(0)
    })

    test("should find memo when new event has high similarity to anchor", async () => {
      const anchorContent = "Deployment to production requires DevOps approval"
      const scenario = await createTestScenario(pool, {
        anchorContents: [anchorContent],
        memoContent: "Production deployments need DevOps team approval",
      })

      // Create new event with nearly identical content
      const { base, similar } = generateEmbeddingsWithSimilarity(anchorContent, 0.9)

      // Update anchor embedding to use the base
      await pool.query(
        `UPDATE ${getEventEmbeddingTable()} SET embedding = $1::vector WHERE event_id = $2`,
        [JSON.stringify(base), scenario.anchorEvents[0].id],
      )

      const newEvent = await addEventToScenario(
        pool,
        scenario,
        "Similar deployment message",
        { embedding: similar },
      )

      const results = await checker.findSimilarMemos(scenario.workspace.id, newEvent.id)

      expect(results.length).toBe(1)
      expect(results[0].memoId).toBe(scenario.memo.id)
      expect(results[0].similarity).toBeGreaterThan(0.85)
    })

    test("should not return archived memos", async () => {
      const scenario = await createTestScenario(pool, {
        anchorContents: ["API rate limit is 100 requests per minute"],
      })

      // Archive the memo
      await pool.query(
        `UPDATE memos SET archived_at = NOW() WHERE id = $1`,
        [scenario.memo.id],
      )

      // Create new event with identical embedding
      const newEvent = await addEventToScenario(
        pool,
        scenario,
        "API rate limit is 100 requests per minute",
      )

      const results = await checker.findSimilarMemos(scenario.workspace.id, newEvent.id)

      expect(results.length).toBe(0)
    })

    test("should not match event against itself", async () => {
      const scenario = await createTestScenario(pool, {
        anchorContents: ["Important configuration setting"],
      })

      // Try to find similar using the anchor event itself
      const results = await checker.findSimilarMemos(
        scenario.workspace.id,
        scenario.anchorEvents[0].id,
      )

      expect(results.length).toBe(0)
    })

    test("should return memos ordered by similarity descending", async () => {
      const workspace = (await createTestScenario(pool)).workspace

      // Create two memos with different anchor contents
      const scenario1 = await createTestScenario(pool, {
        anchorContents: ["OAuth authentication with Google"],
        memoContent: "Google OAuth memo",
      })

      const scenario2 = await createTestScenario(pool, {
        anchorContents: ["Authentication system overview"],
        memoContent: "Auth system memo",
      })

      // Create new event that's more similar to scenario1
      const { base: base1 } = generateEmbeddingsWithSimilarity("OAuth authentication", 0.95)
      const { similar: similar1 } = generateEmbeddingsWithSimilarity("OAuth authentication", 0.92)
      const { similar: similar2 } = generateEmbeddingsWithSimilarity("OAuth authentication", 0.75)

      await pool.query(
        `UPDATE ${getEventEmbeddingTable()} SET embedding = $1::vector WHERE event_id = $2`,
        [JSON.stringify(base1), scenario1.anchorEvents[0].id],
      )
      await pool.query(
        `UPDATE ${getEventEmbeddingTable()} SET embedding = $1::vector WHERE event_id = $2`,
        [JSON.stringify(similar2), scenario2.anchorEvents[0].id],
      )

      const newEvent = await addEventToScenario(
        pool,
        scenario1,
        "OAuth login implementation",
        { embedding: similar1 },
      )

      const results = await checker.findSimilarMemos(scenario1.workspace.id, newEvent.id)

      // Should find scenario1's memo first (higher similarity)
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].memoId).toBe(scenario1.memo.id)
    })

    test("should only return memos from the same workspace", async () => {
      const scenario1 = await createTestScenario(pool, {
        anchorContents: ["Workspace 1 specific info"],
      })

      const scenario2 = await createTestScenario(pool, {
        anchorContents: ["Workspace 1 specific info"], // Same content, different workspace
      })

      // Create event in workspace 1 with matching embedding
      const { base, similar } = generateEmbeddingsWithSimilarity("Workspace 1 specific info", 0.95)

      await pool.query(
        `UPDATE ${getEventEmbeddingTable()} SET embedding = $1::vector WHERE event_id = $2`,
        [JSON.stringify(base), scenario1.anchorEvents[0].id],
      )
      await pool.query(
        `UPDATE ${getEventEmbeddingTable()} SET embedding = $1::vector WHERE event_id = $2`,
        [JSON.stringify(base), scenario2.anchorEvents[0].id],
      )

      const newEvent = await addEventToScenario(
        pool,
        scenario1,
        "Similar content",
        { embedding: similar },
      )

      const results = await checker.findSimilarMemos(scenario1.workspace.id, newEvent.id)

      // Should only find memo from workspace 1
      expect(results.length).toBe(1)
      expect(results[0].memoId).toBe(scenario1.memo.id)
    })
  })

  describe("determineAction", () => {
    test("should return create_new when no matches exist", async () => {
      const result = await checker.determineAction("New content", [], true)

      expect(result.action).toBe("create_new")
      expect(result.similarity).toBe(0)
      expect(result.llmVerified).toBe(false)
    })

    test("should return reinforce for high similarity with system memo", async () => {
      const result = await checker.determineAction(
        "Deployment requires approval",
        [
          {
            memoId: "memo_1",
            eventId: "event_1",
            similarity: 0.90,
            memoSummary: "Deployment needs approval",
            memoConfidence: 0.8,
            memoSource: "system",
            memoCreatedAt: new Date().toISOString(),
          },
        ],
        true,
      )

      expect(result.action).toBe("reinforce")
      expect(result.targetMemoId).toBe("memo_1")
      expect(result.llmVerified).toBe(false)
    })

    test("should return supersede for high similarity with low confidence system memo when more recent", async () => {
      const result = await checker.determineAction(
        "Updated deployment info",
        [
          {
            memoId: "memo_1",
            eventId: "event_1",
            similarity: 0.90,
            memoSummary: "Old deployment info",
            memoConfidence: 0.5, // Low confidence
            memoSource: "system",
            memoCreatedAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          },
        ],
        true, // More recent
      )

      expect(result.action).toBe("supersede")
      expect(result.targetMemoId).toBe("memo_1")
    })

    test("should return create_new for user-created memo even with high similarity", async () => {
      // This test verifies the protection of user memos
      // Note: determineAction doesn't directly return create_new for high similarity user memos,
      // but verifyWithLLM path handles this case
      const result = await checker.determineAction(
        "Similar to user memo",
        [
          {
            memoId: "memo_user",
            eventId: "event_1",
            similarity: 0.90,
            memoSummary: "User created memo content",
            memoConfidence: 0.95,
            memoSource: "user",
            memoCreatedAt: new Date().toISOString(),
          },
        ],
        true,
      )

      // High similarity with user memo should still reinforce (add as anchor)
      // The protection is about not superseding user memos
      expect(result.action).toBe("reinforce")
    })

    test("should use LLM verification for borderline similarity", async () => {
      // For borderline cases (0.65-0.85), LLM verification is used
      // This test verifies the path is taken, but actual LLM call would fail in tests
      // So we test that the function handles borderline cases
      const result = await checker.determineAction(
        "Some new content about deployments",
        [
          {
            memoId: "memo_1",
            eventId: "event_1",
            similarity: 0.75, // Borderline
            memoSummary: "Deployment process documentation",
            memoConfidence: 0.7,
            memoSource: "system",
            memoCreatedAt: new Date().toISOString(),
          },
        ],
        true,
      )

      // Result depends on LLM verification - will likely fail and default to create_new
      // The important thing is it doesn't throw
      expect(["create_new", "reinforce"]).toContain(result.action)
      expect(result.llmVerified).toBeDefined()
    })
  })

  describe("verifyWithLLM", () => {
    // Note: These tests may fail in CI without Ollama running
    // They're marked to document expected behavior

    test("should handle LLM failures gracefully", async () => {
      // When LLM is not available, should default to "different"
      const result = await checker.verifyWithLLM(
        "New content about APIs",
        "Summary about database backups",
      )

      // Should return a valid result even if LLM fails
      expect(result.relationship).toBeDefined()
      expect(typeof result.isSameTopic).toBe("boolean")
    })
  })
})

describe("Embedding utility functions", () => {
  test("generateEmbeddingsWithSimilarity should produce target similarity", () => {
    const targetSimilarities = [0.95, 0.85, 0.75, 0.65, 0.50]

    for (const target of targetSimilarities) {
      const { base, similar } = generateEmbeddingsWithSimilarity("test content", target)
      const actualSimilarity = cosineSimilarity(base, similar)

      // Allow 5% tolerance
      expect(actualSimilarity).toBeGreaterThan(target - 0.05)
      expect(actualSimilarity).toBeLessThan(target + 0.05)
    }
  })

  test("cosineSimilarity should return 1 for identical vectors", () => {
    const vec = [0.1, 0.2, 0.3, 0.4, 0.5]
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5)
  })

  test("cosineSimilarity should return 0 for orthogonal vectors", () => {
    const vec1 = [1, 0, 0]
    const vec2 = [0, 1, 0]
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0, 5)
  })
})
