import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { setupTestDatabase } from "./setup"
import { CursorLock, ensureListener, type ProcessResult, type CursorLockConfig } from "../../src/lib/cursor-lock"
import { OutboxRepository } from "../../src/repositories"
import { withClient } from "./setup"

describe("CursorLock", () => {
  let pool: Pool
  const testListenerId = "test_cursor_lock"

  function createTestCursorLock(overrides?: Partial<CursorLockConfig>): CursorLock {
    return new CursorLock({
      pool,
      listenerId: testListenerId,
      lockDurationMs: 10_000,
      refreshIntervalMs: 5_000,
      maxRetries: 3,
      baseBackoffMs: 100,
      batchSize: 10,
      ...overrides,
    })
  }

  async function getListenerState() {
    return withClient(pool, async (client) => {
      const result = await client.query<{
        last_processed_id: string
        retry_count: number
        retry_after: Date | null
        last_error: string | null
        locked_until: Date | null
        lock_run_id: string | null
      }>(
        `SELECT last_processed_id, retry_count, retry_after, last_error, locked_until, lock_run_id
         FROM outbox_listeners WHERE listener_id = $1`,
        [testListenerId]
      )
      return result.rows[0] ?? null
    })
  }

  async function insertTestEvent(eventType: string = "test:event"): Promise<bigint> {
    return withClient(pool, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO outbox (event_type, payload)
         VALUES ($1, '{"test": true}')
         RETURNING id`,
        [eventType]
      )
      return BigInt(result.rows[0].id)
    })
  }

  async function getDeadLetters() {
    return withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT listener_id, outbox_event_id, error
         FROM outbox_dead_letters WHERE listener_id = $1`,
        [testListenerId]
      )
      return result.rows
    })
  }

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    // Clean up test data between tests
    await pool.query("DELETE FROM outbox_dead_letters WHERE listener_id = $1", [testListenerId])
    await pool.query("DELETE FROM outbox_listeners WHERE listener_id = $1", [testListenerId])
    // Clean outbox events created by tests (events with test payload)
    await pool.query(`DELETE FROM outbox WHERE payload->>'test' = 'true'`)
  })

  describe("ensureListener", () => {
    test("should create listener with default cursor", async () => {
      await ensureListener(pool, testListenerId)

      const state = await getListenerState()
      expect(state).not.toBeNull()
      expect(state!.last_processed_id).toBe("0")
      expect(state!.retry_count).toBe(0)
      expect(state!.retry_after).toBeNull()
    })

    test("should create listener with specified cursor", async () => {
      await ensureListener(pool, testListenerId, 100n)

      const state = await getListenerState()
      expect(state!.last_processed_id).toBe("100")
    })

    test("should not overwrite existing listener", async () => {
      await ensureListener(pool, testListenerId, 50n)
      await ensureListener(pool, testListenerId, 100n)

      const state = await getListenerState()
      expect(state!.last_processed_id).toBe("50")
    })
  })

  describe("run - lock acquisition", () => {
    test("should acquire lock and process events", async () => {
      await ensureListener(pool, testListenerId, 0n)
      const eventId = await insertTestEvent()

      const cursorLock = createTestCursorLock()
      const cursors: bigint[] = []

      const didWork = await cursorLock.run(async (cursor): Promise<ProcessResult> => {
        cursors.push(cursor)
        // Return no_events after processing to stop the exhaust loop
        if (cursor === 0n) {
          return { status: "processed", newCursor: eventId }
        }
        return { status: "no_events" }
      })

      expect(didWork).toBe(true)
      expect(cursors[0]).toBe(0n) // First call should have cursor 0n

      // Verify cursor was updated
      const state = await getListenerState()
      expect(state!.last_processed_id).toBe(eventId.toString())
      // Lock should be released
      expect(state!.locked_until).toBeNull()
      expect(state!.lock_run_id).toBeNull()
    })

    test("should return false when listener does not exist", async () => {
      const cursorLock = createTestCursorLock()

      const didWork = await cursorLock.run(async () => {
        throw new Error("Should not be called")
      })

      expect(didWork).toBe(false)
    })

    test("should return false when lock is already held", async () => {
      await ensureListener(pool, testListenerId, 0n)

      // Manually set a lock that expires in the future
      const futureTime = new Date(Date.now() + 60_000)
      await pool.query(
        `UPDATE outbox_listeners SET locked_until = $1, lock_run_id = 'other_worker'
         WHERE listener_id = $2`,
        [futureTime, testListenerId]
      )

      const cursorLock = createTestCursorLock()
      const didWork = await cursorLock.run(async () => {
        throw new Error("Should not be called")
      })

      expect(didWork).toBe(false)
    })

    test("should acquire expired lock", async () => {
      await ensureListener(pool, testListenerId, 0n)
      const eventId = await insertTestEvent()

      // Set a lock that already expired
      const pastTime = new Date(Date.now() - 1000)
      await pool.query(
        `UPDATE outbox_listeners SET locked_until = $1, lock_run_id = 'old_worker'
         WHERE listener_id = $2`,
        [pastTime, testListenerId]
      )

      const cursorLock = createTestCursorLock()
      const didWork = await cursorLock.run(async (cursor): Promise<ProcessResult> => {
        return { status: "processed", newCursor: eventId }
      })

      expect(didWork).toBe(true)
    })
  })

  describe("run - backoff check", () => {
    test("should return false when in retry backoff", async () => {
      await ensureListener(pool, testListenerId, 0n)

      // Set retry_after to future
      const futureTime = new Date(Date.now() + 60_000)
      await pool.query(`UPDATE outbox_listeners SET retry_after = $1 WHERE listener_id = $2`, [
        futureTime,
        testListenerId,
      ])

      const cursorLock = createTestCursorLock()
      const didWork = await cursorLock.run(async () => {
        throw new Error("Should not be called when in backoff")
      })

      expect(didWork).toBe(false)
    })

    test("should process when retry_after has passed", async () => {
      await ensureListener(pool, testListenerId, 0n)
      const eventId = await insertTestEvent()

      // Set retry_after to past
      const pastTime = new Date(Date.now() - 1000)
      await pool.query(`UPDATE outbox_listeners SET retry_after = $1 WHERE listener_id = $2`, [
        pastTime,
        testListenerId,
      ])

      const cursorLock = createTestCursorLock()
      const didWork = await cursorLock.run(async (): Promise<ProcessResult> => {
        return { status: "processed", newCursor: eventId }
      })

      expect(didWork).toBe(true)
    })

    test("should reset retry state when no_events after recovering from backoff", async () => {
      await ensureListener(pool, testListenerId, 100n)

      // Simulate recovery from error: retry_after in past, but retry state still set
      const pastTime = new Date(Date.now() - 1000)
      await pool.query(
        `UPDATE outbox_listeners
         SET retry_count = 2, retry_after = $1, last_error = 'Previous error'
         WHERE listener_id = $2`,
        [pastTime, testListenerId]
      )

      const cursorLock = createTestCursorLock()
      // Processor returns no_events (cursor already caught up)
      const didWork = await cursorLock.run(async (): Promise<ProcessResult> => {
        return { status: "no_events" }
      })

      expect(didWork).toBe(false)

      // Verify retry state was reset
      const state = await getListenerState()
      expect(state!.retry_count).toBe(0)
      expect(state!.retry_after).toBeNull()
      expect(state!.last_error).toBeNull()
      // Cursor should not have changed
      expect(state!.last_processed_id).toBe("100")
    })
  })

  describe("run - exhaust loop", () => {
    test("should repeatedly call processor until no_events", async () => {
      await ensureListener(pool, testListenerId, 0n)
      const event1 = await insertTestEvent()
      const event2 = await insertTestEvent()
      const event3 = await insertTestEvent()

      const cursorLock = createTestCursorLock()
      const calls: bigint[] = []

      const didWork = await cursorLock.run(async (cursor): Promise<ProcessResult> => {
        calls.push(cursor)

        if (cursor === 0n) {
          return { status: "processed", newCursor: event1 }
        } else if (cursor === event1) {
          return { status: "processed", newCursor: event2 }
        } else if (cursor === event2) {
          return { status: "processed", newCursor: event3 }
        } else {
          return { status: "no_events" }
        }
      })

      expect(didWork).toBe(true)
      expect(calls).toEqual([0n, event1, event2, event3])

      const state = await getListenerState()
      expect(state!.last_processed_id).toBe(event3.toString())
    })

    test("should stop on no_events and report no work when starting exhausted", async () => {
      await ensureListener(pool, testListenerId, 0n)

      const cursorLock = createTestCursorLock()
      const didWork = await cursorLock.run(async (): Promise<ProcessResult> => {
        return { status: "no_events" }
      })

      expect(didWork).toBe(false)
    })

    test("should reject cursor that does not advance", async () => {
      await ensureListener(pool, testListenerId, 10n)

      const cursorLock = createTestCursorLock()
      let callCount = 0

      const didWork = await cursorLock.run(async (cursor): Promise<ProcessResult> => {
        callCount++
        // Return same cursor (doesn't advance)
        return { status: "processed", newCursor: cursor }
      })

      expect(didWork).toBe(false)
      expect(callCount).toBe(1)
    })
  })

  describe("run - error handling", () => {
    test("should record error and set retry backoff", async () => {
      await ensureListener(pool, testListenerId, 0n)

      const cursorLock = createTestCursorLock()
      const didWork = await cursorLock.run(async (): Promise<ProcessResult> => {
        return { status: "error", error: new Error("Test error") }
      })

      expect(didWork).toBe(false)

      const state = await getListenerState()
      expect(state!.retry_count).toBe(1)
      expect(state!.retry_after).not.toBeNull()
      expect(state!.last_error).toBe("Test error")
    })

    test("should move event to DLQ after max retries", async () => {
      // Insert event first, then create listener with cursor just before it
      const eventId = await insertTestEvent()
      await ensureListener(pool, testListenerId, eventId - 1n)

      // Set retry_count to max
      await pool.query(`UPDATE outbox_listeners SET retry_count = 3 WHERE listener_id = $1`, [testListenerId])

      const cursorLock = createTestCursorLock({ maxRetries: 3 })
      await cursorLock.run(async (): Promise<ProcessResult> => {
        return { status: "error", error: new Error("Fatal error") }
      })

      // Check event was moved to DLQ
      const deadLetters = await getDeadLetters()
      expect(deadLetters.length).toBe(1)
      expect(deadLetters[0].outbox_event_id).toBe(eventId.toString())
      expect(deadLetters[0].error).toBe("Fatal error")

      // Cursor should be advanced past the failed event
      const state = await getListenerState()
      expect(state!.last_processed_id).toBe(eventId.toString())
      expect(state!.retry_count).toBe(0)
      expect(state!.retry_after).toBeNull()
    })

    test("should preserve partial progress on error", async () => {
      // Insert events first
      const event1 = await insertTestEvent()
      const event2 = await insertTestEvent()
      // Create listener with cursor just before event1
      await ensureListener(pool, testListenerId, event1 - 1n)

      const cursorLock = createTestCursorLock()
      await cursorLock.run(async (): Promise<ProcessResult> => {
        // Partial progress: processed event1, failed on event2
        return { status: "error", error: new Error("Partial failure"), newCursor: event1 }
      })

      const state = await getListenerState()
      // Cursor should be at event1, not 0
      expect(state!.last_processed_id).toBe(event1.toString())
      expect(state!.retry_count).toBe(1)
    })
  })

  describe("run - testable time", () => {
    test("should use provided getNow function for time comparisons", async () => {
      await ensureListener(pool, testListenerId, 0n)

      // Set retry_after to a specific time
      const retryAfter = new Date("2024-01-01T12:00:00Z")
      await pool.query(`UPDATE outbox_listeners SET retry_after = $1 WHERE listener_id = $2`, [
        retryAfter,
        testListenerId,
      ])

      const cursorLock = createTestCursorLock()

      // When "now" is before retry_after, should not process
      const beforeRetry = () => new Date("2024-01-01T11:59:00Z")
      const didWorkBefore = await cursorLock.run(async () => {
        throw new Error("Should not be called")
      }, beforeRetry)
      expect(didWorkBefore).toBe(false)

      // When "now" is after retry_after, should process
      const afterRetry = () => new Date("2024-01-01T12:01:00Z")
      const eventId = await insertTestEvent()
      const didWorkAfter = await cursorLock.run(async (): Promise<ProcessResult> => {
        return { status: "processed", newCursor: eventId }
      }, afterRetry)
      expect(didWorkAfter).toBe(true)
    })
  })

  describe("lock release on errors", () => {
    test("should release lock even when processor throws", async () => {
      await ensureListener(pool, testListenerId, 0n)

      const cursorLock = createTestCursorLock()

      try {
        await cursorLock.run(async () => {
          throw new Error("Unexpected crash")
        })
      } catch {
        // Expected
      }

      const state = await getListenerState()
      expect(state!.locked_until).toBeNull()
      expect(state!.lock_run_id).toBeNull()
    })
  })
})
