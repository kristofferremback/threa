import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { withTransaction } from "../../src/db"
import {
  OutboxRepository,
  OutboxListenerRepository,
  claimAndFetchEvents,
  claimAndProcessEvents,
  CLAIM_STATUS,
  PROCESS_STATUS,
} from "../../src/repositories"
import { setupTestDatabase } from "./setup"
import { createJobQueue, JobQueues } from "../../src/lib/job-queue"
import { job, emit, emitToUser, type HandlerEffect } from "../../src/lib/handler-effects"

describe("Outbox Multi-Listener", () => {
  let pool: Pool

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    // Clean up test data between tests
    await pool.query("DELETE FROM outbox_dead_letters")
    await pool.query("DELETE FROM outbox_listeners WHERE listener_id LIKE 'test_%'")
    await pool.query(
      "DELETE FROM outbox WHERE id > (SELECT COALESCE(MAX(last_processed_id), 0) FROM outbox_listeners WHERE listener_id = 'broadcast')"
    )
  })

  describe("OutboxListenerRepository.ensureListener", () => {
    test("should create listener if not exists", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_new_listener")

        const result = await client.query(
          "SELECT listener_id, last_processed_id FROM outbox_listeners WHERE listener_id = $1",
          ["test_new_listener"]
        )
        expect(result.rows).toMatchObject([{ listener_id: "test_new_listener", last_processed_id: "0" }])
      })
    })

    test("should not overwrite existing listener", async () => {
      await withTransaction(pool, async (client) => {
        // Create listener with cursor at 100
        await OutboxListenerRepository.ensureListener(client, "test_existing", 100n)

        // Try to re-ensure with cursor at 0
        await OutboxListenerRepository.ensureListener(client, "test_existing", 0n)

        const result = await client.query("SELECT last_processed_id FROM outbox_listeners WHERE listener_id = $1", [
          "test_existing",
        ])
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

        expect(state).toMatchObject({
          listenerId: "test_claim",
          lastProcessedId: 0n,
          retryCount: 0,
          retryAfter: null,
        })
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
  })

  describe("OutboxListenerRepository.isReadyToProcess", () => {
    test("should return true when no retry pending", async () => {
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_ready")

        const isReady = await OutboxListenerRepository.isReadyToProcess(client, "test_ready")

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

        const isReady = await OutboxListenerRepository.isReadyToProcess(client, "test_not_ready")

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

        const isReady = await OutboxListenerRepository.isReadyToProcess(client, "test_retry_past")

        expect(isReady).toBe(true)
      })
    })

    test("should return false for non-existent listener", async () => {
      await withTransaction(pool, async (client) => {
        const isReady = await OutboxListenerRepository.isReadyToProcess(client, "test_nonexistent_ready")

        expect(isReady).toBe(false)
      })
    })
  })

  describe("OutboxRepository.fetchAfterId", () => {
    // Helper to create test message payload
    const testMessagePayload = (streamId: string) => ({
      workspaceId: "ws_test",
      streamId,
      message: {
        id: `msg_test_${Date.now()}`,
        streamId,
        sequence: 1n,
        authorId: "usr_test",
        authorType: "user" as const,
        content: "test",
        contentFormat: "markdown" as const,
        replyCount: 0,
        reactions: {},
        editedAt: null,
        deletedAt: null,
        createdAt: new Date(),
      },
    })

    test("should fetch events after cursor", async () => {
      await withTransaction(pool, async (client) => {
        // Insert some test events
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_1"))
        const second = await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_2"))
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_3"))

        // Fetch events after the second one
        const events = await OutboxRepository.fetchAfterId(client, second.id)

        expect(events.length).toBe(1)
        expect(events[0].eventType).toBe("message:created")
      })
    })

    test("should respect limit parameter", async () => {
      await withTransaction(pool, async (client) => {
        // Get baseline to avoid counting old events
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baselineId = BigInt(maxResult.rows[0].max_id)

        // Insert many events
        for (let i = 0; i < 10; i++) {
          await OutboxRepository.insert(client, "message:created", testMessagePayload(`stream_${i}`))
        }

        const events = await OutboxRepository.fetchAfterId(client, baselineId, 3)

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
    // Helper to create test message payload
    const testMessagePayload = (streamId: string) => ({
      workspaceId: "ws_test",
      streamId,
      message: {
        id: `msg_test_${Date.now()}`,
        streamId,
        sequence: 1n,
        authorId: "usr_test",
        authorType: "user" as const,
        content: "test",
        contentFormat: "markdown" as const,
        replyCount: 0,
        reactions: {},
        editedAt: null,
        deletedAt: null,
        createdAt: new Date(),
      },
    })

    test("should allow independent cursor progress", async () => {
      await withTransaction(pool, async (client) => {
        // Get current max outbox id to use as baseline
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baselineId = BigInt(maxResult.rows[0].max_id)

        // Set up two listeners starting from baseline
        await OutboxListenerRepository.ensureListener(client, "test_listener_a", baselineId)
        await OutboxListenerRepository.ensureListener(client, "test_listener_b", baselineId)

        // Insert events
        const e1 = await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_1"))
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_2"))
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_3"))

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

  describe("Concurrent claim prevention", () => {
    test("should skip locked row with FOR UPDATE SKIP LOCKED", async () => {
      // Set up a listener
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_concurrent")
      })

      // Promise-based synchronization
      let resolveTx1Claimed: () => void
      let resolveTx2Done: () => void
      const tx1Claimed = new Promise<void>((resolve) => {
        resolveTx1Claimed = resolve
      })
      const tx2Done = new Promise<void>((resolve) => {
        resolveTx2Done = resolve
      })

      // tx1: Claims lock and holds it until tx2 finishes
      const tx1 = (async () => {
        const client1 = await pool.connect()
        try {
          await client1.query("BEGIN")

          // Claim the listener (this acquires FOR UPDATE SKIP LOCKED lock)
          const state = await OutboxListenerRepository.claimListener(client1, "test_concurrent")
          resolveTx1Claimed() // Signal that we have the lock

          // Hold lock until tx2 completes its attempt
          await tx2Done

          await client1.query("COMMIT")
          return state
        } catch (err) {
          await client1.query("ROLLBACK")
          throw err
        } finally {
          client1.release()
        }
      })()

      // tx2: Waits for tx1 to claim, then tries to claim (should get null with SKIP LOCKED)
      const tx2 = (async () => {
        const client2 = await pool.connect()
        try {
          await client2.query("BEGIN")

          // Wait for tx1 to have the lock first
          await tx1Claimed

          // With SKIP LOCKED, this should immediately return null (not block)
          const state = await OutboxListenerRepository.claimListener(client2, "test_concurrent")

          await client2.query("COMMIT")
          resolveTx2Done() // Let tx1 know we're done

          return state
        } catch (err) {
          await client2.query("ROLLBACK")
          throw err
        } finally {
          client2.release()
        }
      })()

      // Wait for both transactions to complete
      const [state1, state2] = await Promise.all([tx1, tx2])

      // tx1 should have successfully claimed
      expect(state1).not.toBeNull()
      expect(state1!.lastProcessedId).toBe(0n)

      // tx2 should get null because row was locked (SKIP LOCKED behavior)
      expect(state2).toBeNull()
    })
  })

  describe("claimAndFetchEvents", () => {
    const testMessagePayload = (streamId: string) => ({
      workspaceId: "ws_test",
      streamId,
      event: {
        id: `evt_test_${Date.now()}_${Math.random()}`,
        streamId,
        sequence: 1n,
        actorId: "usr_test",
        actorType: "user" as const,
        type: "message" as const,
        payload: {
          messageId: `msg_test_${Date.now()}`,
          content: "test",
          contentFormat: "markdown" as const,
        },
        createdAt: new Date(),
      },
    })

    test("should return CLAIMED with events when events exist", async () => {
      // Set up listener at baseline
      const baselineId = await withTransaction(pool, async (client) => {
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baseline = BigInt(maxResult.rows[0].max_id)
        await OutboxListenerRepository.ensureListener(client, "test_claim_fetch", baseline)
        return baseline
      })

      // Insert events outside the setup transaction
      await withTransaction(pool, async (client) => {
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_1"))
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_2"))
      })

      const result = await claimAndFetchEvents(pool, "test_claim_fetch", 100)

      expect(result.status).toBe(CLAIM_STATUS.CLAIMED)
      if (result.status === CLAIM_STATUS.CLAIMED) {
        expect(result.events.length).toBe(2)
        expect(result.lastEventId).toBeGreaterThan(baselineId)
      }
    })

    test("should return NO_EVENTS when cursor is caught up", async () => {
      // Set up listener at current max
      await withTransaction(pool, async (client) => {
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const currentMax = BigInt(maxResult.rows[0].max_id)
        await OutboxListenerRepository.ensureListener(client, "test_no_events", currentMax)
      })

      const result = await claimAndFetchEvents(pool, "test_no_events", 100)

      expect(result.status).toBe(CLAIM_STATUS.NO_EVENTS)
    })

    test("should return NOT_READY when listener does not exist", async () => {
      const result = await claimAndFetchEvents(pool, "test_nonexistent_listener", 100)

      expect(result.status).toBe(CLAIM_STATUS.NOT_READY)
    })

    test("should return NOT_READY when in retry backoff", async () => {
      // Set up listener with retry_after in the future
      await withTransaction(pool, async (client) => {
        await OutboxListenerRepository.ensureListener(client, "test_backoff")
        await client.query(
          "UPDATE outbox_listeners SET retry_after = NOW() + interval '1 hour' WHERE listener_id = $1",
          ["test_backoff"]
        )
      })

      const result = await claimAndFetchEvents(pool, "test_backoff", 100)

      expect(result.status).toBe(CLAIM_STATUS.NOT_READY)
    })

    test("should advance cursor after claiming events", async () => {
      // Set up listener at baseline
      await withTransaction(pool, async (client) => {
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baseline = BigInt(maxResult.rows[0].max_id)
        await OutboxListenerRepository.ensureListener(client, "test_cursor_advance", baseline)
      })

      // Insert an event
      await withTransaction(pool, async (client) => {
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_1"))
      })

      // Claim it
      const result = await claimAndFetchEvents(pool, "test_cursor_advance", 100)
      expect(result.status).toBe(CLAIM_STATUS.CLAIMED)

      // Second call should return NO_EVENTS (cursor advanced)
      const result2 = await claimAndFetchEvents(pool, "test_cursor_advance", 100)
      expect(result2.status).toBe(CLAIM_STATUS.NO_EVENTS)
    })

    test("should respect batch size limit", async () => {
      // Set up listener at baseline
      await withTransaction(pool, async (client) => {
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baseline = BigInt(maxResult.rows[0].max_id)
        await OutboxListenerRepository.ensureListener(client, "test_batch_limit", baseline)
      })

      // Insert 5 events
      await withTransaction(pool, async (client) => {
        for (let i = 0; i < 5; i++) {
          await OutboxRepository.insert(client, "message:created", testMessagePayload(`stream_${i}`))
        }
      })

      // Claim with batch size 2
      const result = await claimAndFetchEvents(pool, "test_batch_limit", 2)

      expect(result.status).toBe(CLAIM_STATUS.CLAIMED)
      if (result.status === CLAIM_STATUS.CLAIMED) {
        expect(result.events.length).toBe(2)
      }

      // Second call should get next 2
      const result2 = await claimAndFetchEvents(pool, "test_batch_limit", 2)
      expect(result2.status).toBe(CLAIM_STATUS.CLAIMED)
      if (result2.status === CLAIM_STATUS.CLAIMED) {
        expect(result2.events.length).toBe(2)
      }

      // Third call should get the last 1
      const result3 = await claimAndFetchEvents(pool, "test_batch_limit", 2)
      expect(result3.status).toBe(CLAIM_STATUS.CLAIMED)
      if (result3.status === CLAIM_STATUS.CLAIMED) {
        expect(result3.events.length).toBe(1)
      }
    })
  })

  describe("claimAndProcessEvents", () => {
    let jobQueue: ReturnType<typeof createJobQueue>

    beforeAll(async () => {
      // Create job queue but don't start it - we're only testing job creation
      jobQueue = createJobQueue(pool)
      // Ensure pg-boss schema exists and queue is created
      await jobQueue.getBoss().start()
      await jobQueue.getBoss().createQueue(JobQueues.EMBEDDING_GENERATE)
    })

    afterAll(async () => {
      await jobQueue.stop()
    })

    const testMessagePayload = (streamId: string) => ({
      workspaceId: "ws_test",
      streamId,
      event: {
        id: `evt_test_${Date.now()}_${Math.random()}`,
        streamId,
        sequence: 1n,
        actorId: "usr_test",
        actorType: "user" as const,
        type: "message" as const,
        payload: {
          messageId: `msg_test_${Date.now()}`,
          content: "test",
          contentFormat: "markdown" as const,
        },
        createdAt: new Date(),
      },
    })

    test("should return PROCESSED with events when handler returns effects", async () => {
      // Set up listener at baseline
      const baselineId = await withTransaction(pool, async (client) => {
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baseline = BigInt(maxResult.rows[0].max_id)
        await OutboxListenerRepository.ensureListener(client, "test_process_basic", baseline)
        return baseline
      })

      // Insert events
      await withTransaction(pool, async (client) => {
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_1"))
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_2"))
      })

      const result = await claimAndProcessEvents(pool, jobQueue, "test_process_basic", 100, async (event, _client) => {
        return [emit(`ws:${event.payload.workspaceId}`, event.eventType, event.payload)]
      })

      expect(result.status).toBe(PROCESS_STATUS.PROCESSED)
      if (result.status === PROCESS_STATUS.PROCESSED) {
        expect(result.processedCount).toBe(2)
        expect(result.ephemeralEffects.length).toBe(2)
        expect(result.ephemeralEffects[0].type).toBe("emit")
      }
    })

    test("should return NO_EVENTS when cursor is caught up", async () => {
      await withTransaction(pool, async (client) => {
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const currentMax = BigInt(maxResult.rows[0].max_id)
        await OutboxListenerRepository.ensureListener(client, "test_process_no_events", currentMax)
      })

      const result = await claimAndProcessEvents(pool, jobQueue, "test_process_no_events", 100, async () => [])

      expect(result.status).toBe(PROCESS_STATUS.NO_EVENTS)
    })

    test("should return NOT_READY when listener does not exist", async () => {
      const result = await claimAndProcessEvents(pool, jobQueue, "test_process_nonexistent", 100, async () => [])

      expect(result.status).toBe(PROCESS_STATUS.NOT_READY)
    })

    test("should commit pg-boss jobs atomically with cursor update", async () => {
      // Set up listener at baseline
      await withTransaction(pool, async (client) => {
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baseline = BigInt(maxResult.rows[0].max_id)
        await OutboxListenerRepository.ensureListener(client, "test_atomic_job", baseline)
      })

      // Insert an event
      await withTransaction(pool, async (client) => {
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_atomic"))
      })

      // Count jobs before
      const beforeResult = await pool.query("SELECT COUNT(*) as count FROM pgboss.job WHERE name = $1", [
        JobQueues.EMBEDDING_GENERATE,
      ])
      const jobsBefore = parseInt(beforeResult.rows[0].count)

      // Process with job effect
      const result = await claimAndProcessEvents(pool, jobQueue, "test_atomic_job", 100, async (_event, _client) => {
        return [
          job(JobQueues.EMBEDDING_GENERATE, {
            messageId: "msg_atomic_test",
            workspaceId: "ws_test",
          }),
        ]
      })

      expect(result.status).toBe(PROCESS_STATUS.PROCESSED)

      // Count jobs after
      const afterResult = await pool.query("SELECT COUNT(*) as count FROM pgboss.job WHERE name = $1", [
        JobQueues.EMBEDDING_GENERATE,
      ])
      const jobsAfter = parseInt(afterResult.rows[0].count)

      // Job should have been inserted
      expect(jobsAfter).toBe(jobsBefore + 1)

      // Verify cursor was advanced (second call should return NO_EVENTS)
      const result2 = await claimAndProcessEvents(pool, jobQueue, "test_atomic_job", 100, async () => [])
      expect(result2.status).toBe(PROCESS_STATUS.NO_EVENTS)
    })

    test("should rollback if handler throws", async () => {
      // Set up listener at baseline
      const baselineId = await withTransaction(pool, async (client) => {
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baseline = BigInt(maxResult.rows[0].max_id)
        await OutboxListenerRepository.ensureListener(client, "test_rollback", baseline)
        return baseline
      })

      // Insert an event
      await withTransaction(pool, async (client) => {
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_rollback"))
      })

      // Count jobs before
      const beforeResult = await pool.query("SELECT COUNT(*) as count FROM pgboss.job WHERE name = $1", [
        JobQueues.EMBEDDING_GENERATE,
      ])
      const jobsBefore = parseInt(beforeResult.rows[0].count)

      // Process with handler that throws
      try {
        await claimAndProcessEvents(pool, jobQueue, "test_rollback", 100, async (_event, _client) => {
          throw new Error("Handler failed!")
        })
        expect.unreachable("Should have thrown")
      } catch (err) {
        expect((err as Error).message).toBe("Handler failed!")
      }

      // Job should NOT have been inserted (rolled back)
      const afterResult = await pool.query("SELECT COUNT(*) as count FROM pgboss.job WHERE name = $1", [
        JobQueues.EMBEDDING_GENERATE,
      ])
      const jobsAfter = parseInt(afterResult.rows[0].count)
      expect(jobsAfter).toBe(jobsBefore)

      // Cursor should NOT have advanced (rolled back)
      const result = await claimAndProcessEvents(pool, jobQueue, "test_rollback", 100, async () => [])
      expect(result.status).toBe(PROCESS_STATUS.PROCESSED) // Event still available!
    })

    test("should separate durable and ephemeral effects", async () => {
      await withTransaction(pool, async (client) => {
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baseline = BigInt(maxResult.rows[0].max_id)
        await OutboxListenerRepository.ensureListener(client, "test_effect_separation", baseline)
      })

      await withTransaction(pool, async (client) => {
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_mixed"))
      })

      const result = await claimAndProcessEvents(
        pool,
        jobQueue,
        "test_effect_separation",
        100,
        async (_event, _client): Promise<HandlerEffect[]> => {
          return [
            // Durable effect - executed in transaction
            job(JobQueues.EMBEDDING_GENERATE, {
              messageId: "msg_mixed",
              workspaceId: "ws_test",
            }),
            // Ephemeral effects - returned for execution after commit
            emit("room:test", "message", { hello: "world" }),
            emitToUser("user_123", "notification", { text: "hi" }),
          ]
        }
      )

      expect(result.status).toBe(PROCESS_STATUS.PROCESSED)
      if (result.status === PROCESS_STATUS.PROCESSED) {
        // Only ephemeral effects returned
        expect(result.ephemeralEffects.length).toBe(2)
        expect(result.ephemeralEffects[0].type).toBe("emit")
        expect(result.ephemeralEffects[1].type).toBe("emitToUser")
      }
    })

    test("should handle handler returning empty effects array", async () => {
      await withTransaction(pool, async (client) => {
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baseline = BigInt(maxResult.rows[0].max_id)
        await OutboxListenerRepository.ensureListener(client, "test_empty_effects", baseline)
      })

      await withTransaction(pool, async (client) => {
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_empty"))
      })

      const result = await claimAndProcessEvents(pool, jobQueue, "test_empty_effects", 100, async () => {
        // Handler decided not to produce any effects
        return []
      })

      expect(result.status).toBe(PROCESS_STATUS.PROCESSED)
      if (result.status === PROCESS_STATUS.PROCESSED) {
        expect(result.processedCount).toBe(1)
        expect(result.ephemeralEffects.length).toBe(0)
      }

      // Cursor should still have advanced
      const result2 = await claimAndProcessEvents(pool, jobQueue, "test_empty_effects", 100, async () => [])
      expect(result2.status).toBe(PROCESS_STATUS.NO_EVENTS)
    })

    test("should allow handler to query database within transaction", async () => {
      await withTransaction(pool, async (client) => {
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baseline = BigInt(maxResult.rows[0].max_id)
        await OutboxListenerRepository.ensureListener(client, "test_db_query", baseline)
      })

      await withTransaction(pool, async (client) => {
        await OutboxRepository.insert(client, "message:created", testMessagePayload("stream_query"))
      })

      let queriedListenerId: string | null = null

      const result = await claimAndProcessEvents(pool, jobQueue, "test_db_query", 100, async (_event, client) => {
        // Handler can query the database using the transaction client
        const res = await client.query<{ listener_id: string }>(
          "SELECT listener_id FROM outbox_listeners WHERE listener_id = $1",
          ["test_db_query"]
        )
        queriedListenerId = res.rows[0]?.listener_id ?? null
        return []
      })

      expect(result.status).toBe(PROCESS_STATUS.PROCESSED)
      expect(queriedListenerId).toBe("test_db_query")
    })
  })
})
