/**
 * Tests for ReinforcementTracker
 *
 * Tests reinforcement recording and effective strength calculation
 * with recency-based decay.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { ReinforcementTracker } from "../reinforcement-tracker"
import {
  getTestPool,
  closeTestPool,
  cleanupTestData,
  createTestScenario,
  addEventToScenario,
  getReinforcementsForMemo,
  getMemoById,
} from "./test-helpers"
import { sql } from "../../../lib/db"

describe("ReinforcementTracker", () => {
  let pool: Pool
  let tracker: ReinforcementTracker

  beforeAll(async () => {
    pool = await getTestPool()
    tracker = new ReinforcementTracker(pool)
  })

  afterAll(async () => {
    await closeTestPool()
  })

  beforeEach(async () => {
    await cleanupTestData(pool)
  })

  describe("addReinforcement", () => {
    test("should record original anchor reinforcement", async () => {
      const scenario = await createTestScenario(pool)

      const reinforcement = await tracker.addReinforcement({
        memoId: scenario.memo.id,
        eventId: scenario.anchorEvents[0].id,
        type: "original",
        similarity: 1.0,
        llmVerified: false,
      })

      expect(reinforcement.memoId).toBe(scenario.memo.id)
      expect(reinforcement.eventId).toBe(scenario.anchorEvents[0].id)
      expect(reinforcement.reinforcementType).toBe("original")
      expect(reinforcement.similarityScore).toBe(1.0)
      expect(reinforcement.weight).toBe(1.0)
    })

    test("should record merge reinforcement with similarity score", async () => {
      const scenario = await createTestScenario(pool)
      const newEvent = await addEventToScenario(pool, scenario, "New supporting evidence")

      const reinforcement = await tracker.addReinforcement({
        memoId: scenario.memo.id,
        eventId: newEvent.id,
        type: "merge",
        similarity: 0.87,
        llmVerified: true,
      })

      expect(reinforcement.reinforcementType).toBe("merge")
      expect(reinforcement.similarityScore).toBe(0.87)
      expect(reinforcement.llmVerified).toBe(true)
    })

    test("should update memo reinforcement count and last_reinforced_at", async () => {
      const scenario = await createTestScenario(pool)
      const newEvent = await addEventToScenario(pool, scenario, "Reinforcing content")

      // Get initial memo state
      const initialMemo = await getMemoById(pool, scenario.memo.id)
      const initialConfidence = initialMemo?.confidence || 0

      await tracker.addReinforcement({
        memoId: scenario.memo.id,
        eventId: newEvent.id,
        type: "merge",
        similarity: 0.85,
        llmVerified: false,
      })

      // Check memo was updated
      const result = await pool.query<{
        reinforcement_count: number
        last_reinforced_at: Date
        confidence: number
      }>(
        sql`SELECT reinforcement_count, last_reinforced_at, confidence FROM memos WHERE id = ${scenario.memo.id}`,
      )

      expect(result.rows[0].reinforcement_count).toBeGreaterThanOrEqual(1)
      expect(result.rows[0].last_reinforced_at).toBeDefined()
      expect(result.rows[0].confidence).toBeGreaterThan(initialConfidence)
    })

    test("should handle duplicate reinforcement gracefully (upsert)", async () => {
      const scenario = await createTestScenario(pool)
      const event = scenario.anchorEvents[0]

      // First reinforcement
      await tracker.addReinforcement({
        memoId: scenario.memo.id,
        eventId: event.id,
        type: "original",
        similarity: 0.90,
        llmVerified: false,
      })

      // Duplicate reinforcement should update, not fail
      await tracker.addReinforcement({
        memoId: scenario.memo.id,
        eventId: event.id,
        type: "merge",
        similarity: 0.95,
        llmVerified: true,
      })

      const reinforcements = await getReinforcementsForMemo(pool, scenario.memo.id)

      // Should only have one reinforcement for this event
      const eventReinforcements = reinforcements.filter((r) => r.eventId === event.id)
      expect(eventReinforcements.length).toBe(1)
      // LLM verified should be true (OR of both)
      expect(eventReinforcements[0].llmVerified).toBe(true)
    })

    test("should cap confidence at 1.0", async () => {
      const scenario = await createTestScenario(pool, {
        memoConfidence: 0.98,
      })

      // Add multiple reinforcements
      for (let i = 0; i < 5; i++) {
        const event = await addEventToScenario(pool, scenario, `Reinforcement ${i}`)
        await tracker.addReinforcement({
          memoId: scenario.memo.id,
          eventId: event.id,
          type: "merge",
          similarity: 0.9,
          llmVerified: true,
        })
      }

      const memo = await getMemoById(pool, scenario.memo.id)
      expect(memo?.confidence).toBeLessThanOrEqual(1.0)
    })
  })

  describe("getReinforcementsForMemo", () => {
    test("should return all reinforcements for a memo", async () => {
      const scenario = await createTestScenario(pool)

      // Add original anchor
      await tracker.addReinforcement({
        memoId: scenario.memo.id,
        eventId: scenario.anchorEvents[0].id,
        type: "original",
        similarity: 1.0,
        llmVerified: false,
      })

      // Add a few merge reinforcements
      const events = []
      for (let i = 0; i < 3; i++) {
        const event = await addEventToScenario(pool, scenario, `Merge content ${i}`)
        events.push(event)
        await tracker.addReinforcement({
          memoId: scenario.memo.id,
          eventId: event.id,
          type: "merge",
          similarity: 0.8 + i * 0.05,
          llmVerified: i % 2 === 0,
        })
      }

      const reinforcements = await tracker.getReinforcementsForMemo(scenario.memo.id)

      expect(reinforcements.length).toBe(4) // 1 original + 3 merges
      expect(reinforcements.some((r) => r.reinforcementType === "original")).toBe(true)
      expect(reinforcements.filter((r) => r.reinforcementType === "merge").length).toBe(3)
    })

    test("should return empty array for memo with no reinforcements", async () => {
      const scenario = await createTestScenario(pool)

      const reinforcements = await tracker.getReinforcementsForMemo(scenario.memo.id)

      expect(reinforcements.length).toBe(0)
    })

    test("should return reinforcements ordered by created_at descending", async () => {
      const scenario = await createTestScenario(pool)

      // Add reinforcements with slight delays
      const event1 = await addEventToScenario(pool, scenario, "First")
      await tracker.addReinforcement({
        memoId: scenario.memo.id,
        eventId: event1.id,
        type: "merge",
        similarity: 0.8,
        llmVerified: false,
      })

      const event2 = await addEventToScenario(pool, scenario, "Second")
      await tracker.addReinforcement({
        memoId: scenario.memo.id,
        eventId: event2.id,
        type: "merge",
        similarity: 0.85,
        llmVerified: false,
      })

      const reinforcements = await tracker.getReinforcementsForMemo(scenario.memo.id)

      // Most recent first
      expect(reinforcements[0].eventId).toBe(event2.id)
      expect(reinforcements[1].eventId).toBe(event1.id)
    })
  })

  describe("calculateEffectiveStrength", () => {
    test("should return 0 for non-existent memo", async () => {
      const strength = await tracker.calculateEffectiveStrength("non_existent_memo")

      expect(strength.baseConfidence).toBe(0)
      expect(strength.total).toBe(0)
    })

    test("should return base confidence for memo with no reinforcements", async () => {
      const scenario = await createTestScenario(pool, {
        memoConfidence: 0.75,
      })

      const strength = await tracker.calculateEffectiveStrength(scenario.memo.id)

      expect(strength.baseConfidence).toBe(0.75)
      expect(strength.reinforcementBoost).toBe(0)
      expect(strength.recencyBonus).toBe(0)
      expect(strength.total).toBe(0.75)
    })

    test("should add recency bonus for recently reinforced memo", async () => {
      const scenario = await createTestScenario(pool, {
        memoConfidence: 0.7,
      })

      // Add recent reinforcement
      const event = await addEventToScenario(pool, scenario, "Recent reinforcement")
      await tracker.addReinforcement({
        memoId: scenario.memo.id,
        eventId: event.id,
        type: "merge",
        similarity: 0.85,
        llmVerified: false,
      })

      const strength = await tracker.calculateEffectiveStrength(scenario.memo.id)

      // Should have recency bonus (0.1 for < 7 days)
      expect(strength.recencyBonus).toBeGreaterThan(0)
      expect(strength.total).toBeGreaterThan(strength.baseConfidence)
    })

    test("should apply decay to old reinforcements", async () => {
      const scenario = await createTestScenario(pool, {
        memoConfidence: 0.6,
      })

      // Add reinforcement
      const event = await addEventToScenario(pool, scenario, "Old reinforcement")
      await tracker.addReinforcement({
        memoId: scenario.memo.id,
        eventId: event.id,
        type: "merge",
        similarity: 0.9,
        llmVerified: true,
      })

      // Artificially age the reinforcement (2 months old)
      await pool.query(
        sql`UPDATE memo_reinforcements
            SET created_at = NOW() - INTERVAL '60 days'
            WHERE memo_id = ${scenario.memo.id} AND event_id = ${event.id}`,
      )

      // Also update last_reinforced_at to be old (for no recency bonus)
      await pool.query(
        sql`UPDATE memos SET last_reinforced_at = NOW() - INTERVAL '60 days' WHERE id = ${scenario.memo.id}`,
      )

      const strength = await tracker.calculateEffectiveStrength(scenario.memo.id)

      // Reinforcement boost should be reduced due to decay
      // 2 months = ~0.82 decay factor (e^(-0.1 * 2))
      expect(strength.reinforcementBoost).toBeLessThan(0.05) // Less than full 5% boost
      expect(strength.recencyBonus).toBe(0) // No recency bonus for old memo
    })

    test("should cap total strength at 1.0", async () => {
      const scenario = await createTestScenario(pool, {
        memoConfidence: 0.95,
      })

      // Add many reinforcements
      for (let i = 0; i < 10; i++) {
        const event = await addEventToScenario(pool, scenario, `Reinforcement ${i}`)
        await tracker.addReinforcement({
          memoId: scenario.memo.id,
          eventId: event.id,
          type: "merge",
          similarity: 0.9,
          llmVerified: true,
        })
      }

      const strength = await tracker.calculateEffectiveStrength(scenario.memo.id)

      expect(strength.total).toBeLessThanOrEqual(1.0)
    })
  })

  describe("isEventAlreadyReinforcing", () => {
    test("should return null for event not reinforcing any memo", async () => {
      const scenario = await createTestScenario(pool)

      const memoId = await tracker.isEventAlreadyReinforcing(scenario.anchorEvents[0].id)

      expect(memoId).toBeNull()
    })

    test("should return memo ID for event that is reinforcing", async () => {
      const scenario = await createTestScenario(pool)

      await tracker.addReinforcement({
        memoId: scenario.memo.id,
        eventId: scenario.anchorEvents[0].id,
        type: "original",
        similarity: 1.0,
        llmVerified: false,
      })

      const memoId = await tracker.isEventAlreadyReinforcing(scenario.anchorEvents[0].id)

      expect(memoId).toBe(scenario.memo.id)
    })
  })
})
