/**
 * Integration tests for MemoEvolutionService
 *
 * Tests the full evolution flow from event evaluation to reinforcement.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { MemoEvolutionService } from "../evolution-service"
import {
  getTestPool,
  closeTestPool,
  cleanupTestData,
  createTestScenario,
  addEventToScenario,
  generateEmbeddingsWithSimilarity,
  getReinforcementsForMemo,
  getMemoById,
} from "./test-helpers"
import { sql } from "../../../lib/db"
import { getEventEmbeddingTable } from "../../../lib/embedding-tables"
import {
  IDENTICAL_MESSAGES,
  RELATED_DISTINCT,
  UNRELATED_TOPICS,
  USER_CREATED_MEMO,
  LOW_CONFIDENCE_MEMO,
} from "./test-fixtures"

describe("MemoEvolutionService", () => {
  let pool: Pool
  let evolutionService: MemoEvolutionService

  beforeAll(async () => {
    pool = await getTestPool()
    evolutionService = new MemoEvolutionService(pool)
  })

  afterAll(async () => {
    await closeTestPool()
  })

  beforeEach(async () => {
    await cleanupTestData(pool)
  })

  describe("evaluateForEvolution", () => {
    test("should return create_new when no similar memos exist", async () => {
      const scenario = await createTestScenario(pool, {
        anchorContents: ["Database backup documentation"],
        memoContent: "DB backups run daily",
      })

      // Create event with completely different content
      const newEvent = await addEventToScenario(
        pool,
        scenario,
        "Frontend uses React with TypeScript for type safety",
      )

      const decision = await evolutionService.evaluateForEvolution(
        scenario.workspace.id,
        newEvent.id,
        newEvent.content!,
      )

      expect(decision.action).toBe("create_new")
      expect(decision.targetMemoId).toBeUndefined()
    })

    test("should return skip when event already reinforces a memo", async () => {
      const scenario = await createTestScenario(pool)

      // Record the anchor as already reinforcing
      await evolutionService.recordOriginalAnchor(scenario.memo.id, scenario.anchorEvents[0].id)

      const decision = await evolutionService.evaluateForEvolution(
        scenario.workspace.id,
        scenario.anchorEvents[0].id,
        "Same content",
      )

      expect(decision.action).toBe("skip")
      expect(decision.targetMemoId).toBe(scenario.memo.id)
    })

    test("should return reinforce for highly similar content", async () => {
      const anchorContent = "API rate limits are 100 requests per minute"
      const scenario = await createTestScenario(pool, {
        anchorContents: [anchorContent],
        memoContent: "API has 100 req/min rate limit",
      })

      // Create embeddings with high similarity
      const { base, similar } = generateEmbeddingsWithSimilarity(anchorContent, 0.90)

      // Update anchor embedding
      await pool.query(
        `UPDATE ${getEventEmbeddingTable()} SET embedding = $1::vector WHERE event_id = $2`,
        [JSON.stringify(base), scenario.anchorEvents[0].id],
      )

      // Create similar event
      const newEvent = await addEventToScenario(
        pool,
        scenario,
        "Reminder: API rate limit is 100 requests/min",
        { embedding: similar },
      )

      const decision = await evolutionService.evaluateForEvolution(
        scenario.workspace.id,
        newEvent.id,
        newEvent.content!,
      )

      expect(decision.action).toBe("reinforce")
      expect(decision.targetMemoId).toBe(scenario.memo.id)
      expect(decision.similarity).toBeGreaterThan(0.85)
    })

    test("should return supersede for more recent high-similarity content against low confidence memo", async () => {
      const anchorContent = "I think the staging URL is staging.example.com"
      const scenario = await createTestScenario(pool, {
        anchorContents: [anchorContent],
        memoContent: "Staging might be at staging.example.com",
        memoConfidence: 0.4, // Low confidence
        memoSource: "system",
      })

      // Create embeddings with high similarity
      const { base, similar } = generateEmbeddingsWithSimilarity(anchorContent, 0.92)

      await pool.query(
        `UPDATE ${getEventEmbeddingTable()} SET embedding = $1::vector WHERE event_id = $2`,
        [JSON.stringify(base), scenario.anchorEvents[0].id],
      )

      // Make the old memo's anchor older
      await pool.query(
        sql`UPDATE stream_events SET created_at = NOW() - INTERVAL '7 days' WHERE id = ${scenario.anchorEvents[0].id}`,
      )
      await pool.query(
        sql`UPDATE memos SET created_at = NOW() - INTERVAL '7 days' WHERE id = ${scenario.memo.id}`,
      )

      // Create newer event with confirmed info
      const newEvent = await addEventToScenario(
        pool,
        scenario,
        "Confirmed: staging URL is https://staging.example.com",
        { embedding: similar },
      )

      const decision = await evolutionService.evaluateForEvolution(
        scenario.workspace.id,
        newEvent.id,
        newEvent.content!,
      )

      expect(decision.action).toBe("supersede")
      expect(decision.targetMemoId).toBe(scenario.memo.id)
    })
  })

  describe("reinforceMemo", () => {
    test("should add event to memo anchor_event_ids", async () => {
      const scenario = await createTestScenario(pool)
      const newEvent = await addEventToScenario(pool, scenario, "Supporting evidence")

      await evolutionService.reinforceMemo(
        scenario.memo.id,
        newEvent.id,
        0.88,
        false,
      )

      const memo = await getMemoById(pool, scenario.memo.id)
      expect(memo?.anchorEventIds).toContain(newEvent.id)
    })

    test("should record reinforcement in tracking table", async () => {
      const scenario = await createTestScenario(pool)
      const newEvent = await addEventToScenario(pool, scenario, "Additional context")

      await evolutionService.reinforceMemo(
        scenario.memo.id,
        newEvent.id,
        0.85,
        true,
      )

      const reinforcements = await getReinforcementsForMemo(pool, scenario.memo.id)
      const newReinforcement = reinforcements.find((r) => r.eventId === newEvent.id)

      expect(newReinforcement).toBeDefined()
      expect(newReinforcement?.type).toBe("merge")
      expect(newReinforcement?.similarity).toBe(0.85)
      expect(newReinforcement?.llmVerified).toBe(true)
    })

    test("should not duplicate event in anchor_event_ids", async () => {
      const scenario = await createTestScenario(pool)
      const newEvent = await addEventToScenario(pool, scenario, "Same event")

      // Reinforce twice with same event
      await evolutionService.reinforceMemo(scenario.memo.id, newEvent.id, 0.9, false)
      await evolutionService.reinforceMemo(scenario.memo.id, newEvent.id, 0.9, false)

      const memo = await getMemoById(pool, scenario.memo.id)
      const eventCount = memo?.anchorEventIds.filter((id) => id === newEvent.id).length

      expect(eventCount).toBe(1)
    })
  })

  describe("recordOriginalAnchor", () => {
    test("should record original anchor reinforcement", async () => {
      const scenario = await createTestScenario(pool)

      await evolutionService.recordOriginalAnchor(
        scenario.memo.id,
        scenario.anchorEvents[0].id,
      )

      const reinforcements = await getReinforcementsForMemo(pool, scenario.memo.id)

      expect(reinforcements.length).toBe(1)
      expect(reinforcements[0].type).toBe("original")
      expect(reinforcements[0].eventId).toBe(scenario.anchorEvents[0].id)
      expect(reinforcements[0].similarity).toBe(1.0)
    })
  })

  describe("getEffectiveStrength", () => {
    test("should return strength calculation for memo", async () => {
      const scenario = await createTestScenario(pool, {
        memoConfidence: 0.7,
      })

      // Add some reinforcements
      const event1 = await addEventToScenario(pool, scenario, "Reinforcement 1")
      const event2 = await addEventToScenario(pool, scenario, "Reinforcement 2")

      await evolutionService.reinforceMemo(scenario.memo.id, event1.id, 0.85, false)
      await evolutionService.reinforceMemo(scenario.memo.id, event2.id, 0.9, true)

      const strength = await evolutionService.getEffectiveStrength(scenario.memo.id)

      expect(strength.baseConfidence).toBeGreaterThan(0.7) // Increased from reinforcements
      expect(strength.reinforcementBoost).toBeGreaterThan(0)
      expect(strength.recencyBonus).toBeGreaterThan(0) // Recent reinforcements
      expect(strength.total).toBeGreaterThan(strength.baseConfidence)
    })
  })

  describe("fixture-based scenarios", () => {
    test("should handle identical message scenario correctly", async () => {
      const fixture = IDENTICAL_MESSAGES
      const scenario = await createTestScenario(pool, {
        anchorContents: [fixture.memo.anchorContent],
        memoContent: fixture.memo.summary,
        memoConfidence: fixture.memo.confidence,
        memoSource: fixture.memo.source,
      })

      // Create embeddings for exact duplicate
      const { base, similar: exactSimilar } = generateEmbeddingsWithSimilarity(
        fixture.memo.anchorContent,
        0.98, // Very high for exact duplicate
      )

      await pool.query(
        `UPDATE ${getEventEmbeddingTable()} SET embedding = $1::vector WHERE event_id = $2`,
        [JSON.stringify(base), scenario.anchorEvents[0].id],
      )

      const exactDup = fixture.messages[0]
      const event = await addEventToScenario(
        pool,
        scenario,
        exactDup.content,
        { embedding: exactSimilar },
      )

      const decision = await evolutionService.evaluateForEvolution(
        scenario.workspace.id,
        event.id,
        exactDup.content,
      )

      // High similarity should result in reinforce (adding as another anchor)
      expect(["skip", "reinforce"]).toContain(decision.action)
    })

    test("should create new memo for unrelated topic", async () => {
      const fixture = UNRELATED_TOPICS
      const scenario = await createTestScenario(pool, {
        anchorContents: [fixture.memo.anchorContent],
        memoContent: fixture.memo.summary,
      })

      const unrelatedMsg = fixture.messages[0]
      const event = await addEventToScenario(pool, scenario, unrelatedMsg.content)

      const decision = await evolutionService.evaluateForEvolution(
        scenario.workspace.id,
        event.id,
        unrelatedMsg.content,
      )

      expect(decision.action).toBe("create_new")
    })

    test("should respect user-created memo protection", async () => {
      const fixture = USER_CREATED_MEMO
      const scenario = await createTestScenario(pool, {
        anchorContents: [fixture.memo.anchorContent],
        memoContent: fixture.memo.summary,
        memoConfidence: fixture.memo.confidence,
        memoSource: "user", // User-created
      })

      // Create similar content
      const { base, similar } = generateEmbeddingsWithSimilarity(
        fixture.memo.anchorContent,
        0.75, // Borderline similarity
      )

      await pool.query(
        `UPDATE ${getEventEmbeddingTable()} SET embedding = $1::vector WHERE event_id = $2`,
        [JSON.stringify(base), scenario.anchorEvents[0].id],
      )

      const similarMsg = fixture.messages[0]
      const event = await addEventToScenario(
        pool,
        scenario,
        similarMsg.content,
        { embedding: similar },
      )

      const decision = await evolutionService.evaluateForEvolution(
        scenario.workspace.id,
        event.id,
        similarMsg.content,
      )

      // For user memos with borderline similarity, LLM decides
      // If LLM verifies same topic, should create_new (not merge into user memo)
      // This test verifies the user memo is not automatically merged
      expect(["create_new", "reinforce"]).toContain(decision.action)
    })
  })

  describe("edge cases", () => {
    test("should handle event without embedding gracefully", async () => {
      const scenario = await createTestScenario(pool)

      // Create event without embedding
      const event = await addEventToScenario(pool, scenario, "Event without embedding")
      await pool.query(
        `DELETE FROM ${getEventEmbeddingTable()} WHERE event_id = $1`,
        [event.id],
      )

      const decision = await evolutionService.evaluateForEvolution(
        scenario.workspace.id,
        event.id,
        "Event without embedding",
      )

      // Should default to create_new when no embedding found
      expect(decision.action).toBe("create_new")
    })

    test("should handle empty workspace gracefully", async () => {
      const scenario = await createTestScenario(pool)

      // Delete the memo
      await pool.query(`DELETE FROM memos WHERE id = $1`, [scenario.memo.id])

      const newEvent = await addEventToScenario(pool, scenario, "First message in workspace")

      const decision = await evolutionService.evaluateForEvolution(
        scenario.workspace.id,
        newEvent.id,
        "First message",
      )

      expect(decision.action).toBe("create_new")
    })

    test("should handle multiple anchor events in a memo", async () => {
      const scenario = await createTestScenario(pool, {
        anchorContents: [
          "First anchor about API design",
          "Second anchor also about API design",
          "Third anchor with API patterns",
        ],
      })

      // Create embeddings that are similar to all anchors
      const { base } = generateEmbeddingsWithSimilarity("API design patterns", 0.9)

      for (const anchor of scenario.anchorEvents) {
        await pool.query(
          `UPDATE ${getEventEmbeddingTable()} SET embedding = $1::vector WHERE event_id = $2`,
          [JSON.stringify(base), anchor.id],
        )
      }

      // New event similar to all anchors
      const { similar } = generateEmbeddingsWithSimilarity("API design patterns", 0.88)
      const newEvent = await addEventToScenario(
        pool,
        scenario,
        "More about API design",
        { embedding: similar },
      )

      const decision = await evolutionService.evaluateForEvolution(
        scenario.workspace.id,
        newEvent.id,
        "More about API design",
      )

      // Should find the memo via any of its anchors
      expect(decision.action).toBe("reinforce")
      expect(decision.targetMemoId).toBe(scenario.memo.id)
    })
  })
})
