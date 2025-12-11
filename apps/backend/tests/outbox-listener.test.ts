/**
 * Unit tests for outbox multi-listener infrastructure.
 * Tests the OutboxListenerRepository and cursor management logic.
 *
 * Run with: bun test tests/outbox-listener.test.ts
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool, PoolClient } from "pg"
import { createDatabasePool, withTransaction } from "../src/db"
import { OutboxRepository, OutboxListenerRepository } from "../src/repositories"
import { createMigrator } from "../src/db/migrations"

describe("Outbox Multi-Listener", () => {
  let pool: Pool

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/threa_test"
    pool = createDatabasePool(databaseUrl)

    const migrator = createMigrator(pool)
    await migrator.up()
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    // Clean up test data between tests
    await pool.query("DELETE FROM outbox_dead_letters")
    await pool.query("DELETE FROM outbox_listeners WHERE listener_id LIKE 'test_%'")
    await pool.query("DELETE FROM outbox WHERE id > (SELECT COALESCE(MAX(last_processed_id), 0) FROM outbox_listeners WHERE listener_id = 'broadcast')")
  })

  describe("OutboxListenerRepository.ensureListener", () => {
    test("should create listener if not exists", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_new_listener")

        const result = await client.query(
          "SELECT listener_id, last_processed_id FROM outbox_listeners WHERE listener_id = $1",
          ["test_new_listener"]
        )
        expect(result.rows.length).toBe(1)
        expect(result.rows[0].listener_id).toBe("test_new_listener")
        expect(result.rows[0].last_processed_id).toBe("0")
      })
    })

    test("should not overwrite existing listener", async () => {
      await withTransaction(pool, async (client) => {
        // Create listener with cursor at 100
        await OutboxListenerRepository.ensureListener(client, "test_existing", 100n)

        // Try to re-ensure with cursor at 0
        await OutboxListenerRepository.ensureListener(client, "test_existing", 0n)

        const result = await client.query(
          "SELECT last_processed_id FROM outbox_listeners WHERE listener_id = $1",
          ["test_existing"]
        )
        // Should still be at 100
        expect(result.rows[0].last_processed_id).toBe("100")
      })
    })
  })

  describe("OutboxListenerRepository.claimListener", () => {
    test("should return listener state", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_claim")

        const state = await OutboxListenerRepository.claimListener(client, "test_claim")

        expect(state).not.toBeNull()
        expect(state!.listenerId).toBe("test_claim")
        expect(state!.lastProcessedId).toBe(0n)
        expect(state!.retryCount).toBe(0)
        expect(state!.retryAfter).toBeNull()
      })
    })

    test("should return null for non-existent listener", async () => {
      await withTransaction(pool, async (client) => {
        const state = await OutboxListenerRepository.claimListener(client, "test_nonexistent")
        expect(state).toBeNull()
      })
    })
  })

  describe("OutboxListenerRepository.updateCursor", () => {
    test("should update cursor position", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_update_cursor")

        await OutboxListenerRepository.updateCursor(client, "test_update_cursor", 42n)

        const state = await OutboxListenerRepository.claimListener(client, "test_update_cursor")
        expect(state!.lastProcessedId).toBe(42n)
        expect(state!.lastProcessedAt).not.toBeNull()
      })
    })

    test("should reset retry state on success", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_reset_retry")

        // Simulate a failure first
        await OutboxListenerRepository.recordError(
          client,
          "test_reset_retry",
          "test error",
          5,
          1000
        )

        // Now update cursor (success)
        await OutboxListenerRepository.updateCursor(client, "test_reset_retry", 10n)

        const state = await OutboxListenerRepository.claimListener(client, "test_reset_retry")
        expect(state!.retryCount).toBe(0)
        expect(state!.retryAfter).toBeNull()
        expect(state!.lastError).toBeNull()
      })
    })
  })

  describe("OutboxListenerRepository.recordError", () => {
    test("should increment retry count and set retry_after", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_error")

        const retryAfter = await OutboxListenerRepository.recordError(
          client,
          "test_error",
          "Something went wrong",
          5,
          1000
        )

        expect(retryAfter).not.toBeNull()
        expect(retryAfter!.getTime()).toBeGreaterThan(Date.now())

        const state = await OutboxListenerRepository.claimListener(client, "test_error")
        expect(state!.retryCount).toBe(1)
        expect(state!.lastError).toBe("Something went wrong")
      })
    })

    test("should return null when max retries exceeded", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_max_retry")

        // Record 5 errors (max retries)
        for (let i = 0; i < 5; i++) {
          await OutboxListenerRepository.recordError(
            client,
            "test_max_retry",
            `Error ${i + 1}`,
            5,
            1000
          )
        }

        // 6th error should return null (exceeded)
        const retryAfter = await OutboxListenerRepository.recordError(
          client,
          "test_max_retry",
          "Error 6",
          5,
          1000
        )

        expect(retryAfter).toBeNull()
      })
    })
  })

  describe("OutboxListenerRepository.moveToDeadLetter", () => {
    test("should move event to dead letter table", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_dead_letter")

        await OutboxListenerRepository.moveToDeadLetter(
          client,
          "test_dead_letter",
          123n,
          "Max retries exceeded"
        )

        const result = await client.query(
          "SELECT listener_id, outbox_event_id, error FROM outbox_dead_letters WHERE listener_id = $1",
          ["test_dead_letter"]
        )
        expect(result.rows.length).toBe(1)
        expect(result.rows[0].outbox_event_id).toBe("123")
        expect(result.rows[0].error).toBe("Max retries exceeded")
      })
    })

    test("should reset retry state after dead lettering", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_dead_reset")

        // Simulate retries
        await OutboxListenerRepository.recordError(
          client,
          "test_dead_reset",
          "Error",
          5,
          1000
        )

        // Move to dead letter
        await OutboxListenerRepository.moveToDeadLetter(
          client,
          "test_dead_reset",
          999n,
          "Final error"
        )

        const state = await OutboxListenerRepository.claimListener(client, "test_dead_reset")
        expect(state!.retryCount).toBe(0)
        expect(state!.retryAfter).toBeNull()
        expect(state!.lastError).toBeNull()
      })
    })
  })

  describe("OutboxListenerRepository.isReadyToProcess", () => {
    test("should return true when no retry pending", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_ready")

        const isReady = await OutboxListenerRepository.isReadyToProcess(
          client,
          "test_ready"
        )

        expect(isReady).toBe(true)
      })
    })

    test("should return false when retry_after is in future", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_not_ready")

        // Set retry_after to 1 hour from now
        await client.query(
          "UPDATE outbox_listeners SET retry_after = NOW() + interval '1 hour' WHERE listener_id = $1",
          ["test_not_ready"]
        )

        const isReady = await OutboxListenerRepository.isReadyToProcess(
          client,
          "test_not_ready"
        )

        expect(isReady).toBe(false)
      })
    })

    test("should return true when retry_after is in past", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_retry_past")

        // Set retry_after to 1 hour ago
        await client.query(
          "UPDATE outbox_listeners SET retry_after = NOW() - interval '1 hour' WHERE listener_id = $1",
          ["test_retry_past"]
        )

        const isReady = await OutboxListenerRepository.isReadyToProcess(
          client,
          "test_retry_past"
        )

        expect(isReady).toBe(true)
      })
    })

    test("should return false for non-existent listener", async () => {
      await withTransaction(pool, async (client) => {
        const isReady = await OutboxListenerRepository.isReadyToProcess(
          client,
          "test_nonexistent_ready"
        )

        expect(isReady).toBe(false)
      })
    })
  })

  describe("OutboxRepository.fetchAfterId", () => {
    test("should fetch events after cursor", async () => {
      await withTransaction(pool, async (client) => {
        // Insert some test events
        await OutboxRepository.insert(client, "test:event1", { data: "first" })
        const second = await OutboxRepository.insert(client, "test:event2", { data: "second" })
        await OutboxRepository.insert(client, "test:event3", { data: "third" })

        // Fetch events after the second one
        const events = await OutboxRepository.fetchAfterId(client, second.id)

        expect(events.length).toBe(1)
        expect(events[0].eventType).toBe("test:event3")
      })
    })

    test("should respect limit parameter", async () => {
      await withTransaction(pool, async (client) => {
        // Insert many events
        for (let i = 0; i < 10; i++) {
          await OutboxRepository.insert(client, `test:event${i}`, { index: i })
        }

        const events = await OutboxRepository.fetchAfterId(client, 0n, 3)

        expect(events.length).toBe(3)
      })
    })

    test("should return empty array when no events after cursor", async () => {
      await withTransaction(pool, async (client) => {
        const events = await OutboxRepository.fetchAfterId(client, 999999999n)
        expect(events.length).toBe(0)
      })
    })
  })

  describe("Multi-listener isolation", () => {
    test("should allow independent cursor progress", async () => {
      await withTransaction(pool, async (client) => {
        // Get current max outbox id to use as baseline
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baselineId = BigInt(maxResult.rows[0].max_id)

        // Set up two listeners starting from baseline
        await OutboxListenerRepository.ensureListener(client, "test_listener_a", baselineId)
        await OutboxListenerRepository.ensureListener(client, "test_listener_b", baselineId)

        // Insert events
        const e1 = await OutboxRepository.insert(client, "test:event", { n: 1 })
        await OutboxRepository.insert(client, "test:event", { n: 2 })
        await OutboxRepository.insert(client, "test:event", { n: 3 })

        // Listener A processes first event only
        await OutboxListenerRepository.updateCursor(client, "test_listener_a", e1.id)

        // Check states
        const stateA = await OutboxListenerRepository.claimListener(client, "test_listener_a")
        const stateB = await OutboxListenerRepository.claimListener(client, "test_listener_b")

        expect(stateA!.lastProcessedId).toBe(e1.id)
        expect(stateB!.lastProcessedId).toBe(baselineId)

        // Listener B should see all 3 events (from baseline)
        const eventsB = await OutboxRepository.fetchAfterId(client, stateB!.lastProcessedId)
        expect(eventsB.length).toBe(3)

        // Listener A should see only 2 events (after e1)
        const eventsA = await OutboxRepository.fetchAfterId(client, stateA!.lastProcessedId)
        expect(eventsA.length).toBe(2)
      })
    })
  })
})
