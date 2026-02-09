import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { withTestTransaction } from "./setup"
import { OutboxRepository } from "../../src/lib/outbox"
import { setupTestDatabase } from "./setup"

describe("OutboxRepository", () => {
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

  describe("OutboxRepository.fetchAfterId", () => {
    // Helper to create test event payload
    const testEventPayload = (streamId: string) => ({
      workspaceId: "ws_test",
      streamId,
      event: {
        id: `evt_test_${Date.now()}_${Math.random()}`,
        streamId,
        sequence: 1n,
        eventType: "message_created" as const,
        payload: { messageId: `msg_test_${Date.now()}`, content: "test" },
        actorId: "usr_test",
        actorType: "user" as const,
        createdAt: new Date(),
      },
    })

    test("should fetch events after cursor", async () => {
      await withTestTransaction(pool, async (client) => {
        // Insert some test events
        await OutboxRepository.insert(client, "message:created", testEventPayload("stream_1"))
        const second = await OutboxRepository.insert(client, "message:created", testEventPayload("stream_2"))
        await OutboxRepository.insert(client, "message:created", testEventPayload("stream_3"))

        // Fetch events after the second one
        const events = await OutboxRepository.fetchAfterId(client, second.id)

        expect(events.length).toBe(1)
        expect(events[0].eventType).toBe("message:created")
      })
    })

    test("should respect limit parameter", async () => {
      await withTestTransaction(pool, async (client) => {
        // Get baseline to avoid counting old events
        const maxResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baselineId = BigInt(maxResult.rows[0].max_id)

        // Insert many events
        for (let i = 0; i < 10; i++) {
          await OutboxRepository.insert(client, "message:created", testEventPayload(`stream_${i}`))
        }

        const events = await OutboxRepository.fetchAfterId(client, baselineId, 3)

        expect(events.length).toBe(3)
      })
    })

    test("should return empty array when no events after cursor", async () => {
      await withTestTransaction(pool, async (client) => {
        const events = await OutboxRepository.fetchAfterId(client, 999999999n)
        expect(events.length).toBe(0)
      })
    })
  })

  describe("OutboxRepository.getRetentionWatermark", () => {
    test("should return minimum cursor when all listeners exist", async () => {
      await withTestTransaction(pool, async (client) => {
        const listenerA = `test_listener_a_${crypto.randomUUID()}`
        const listenerB = `test_listener_b_${crypto.randomUUID()}`

        await client.query("INSERT INTO outbox_listeners (listener_id, last_processed_id) VALUES ($1, $2), ($3, $4)", [
          listenerA,
          "42",
          listenerB,
          "7",
        ])

        const watermark = await OutboxRepository.getRetentionWatermark(client, [listenerA, listenerB])
        expect(watermark).toBe(7n)
      })
    })

    test("should return null when any listener is missing", async () => {
      await withTestTransaction(pool, async (client) => {
        const existingListener = `test_listener_existing_${crypto.randomUUID()}`
        const missingListener = `test_listener_missing_${crypto.randomUUID()}`

        await client.query("INSERT INTO outbox_listeners (listener_id, last_processed_id) VALUES ($1, $2)", [
          existingListener,
          "100",
        ])

        const watermark = await OutboxRepository.getRetentionWatermark(client, [existingListener, missingListener])
        expect(watermark).toBeNull()
      })
    })
  })

  describe("OutboxRepository.deleteRetainedEvents", () => {
    const testEventPayload = (streamId: string) => ({
      workspaceId: "ws_test",
      streamId,
      event: {
        id: `evt_test_${Date.now()}_${Math.random()}`,
        streamId,
        sequence: 1n,
        eventType: "message_created" as const,
        payload: { messageId: `msg_test_${Date.now()}`, content: "test" },
        actorId: "usr_test",
        actorType: "user" as const,
        createdAt: new Date(),
      },
    })

    test("should delete only rows at or below watermark and older than cutoff", async () => {
      await withTestTransaction(pool, async (client) => {
        const baselineResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baselineId = BigInt(baselineResult.rows[0].max_id)

        const first = await OutboxRepository.insert(client, "message:created", testEventPayload("stream_1"))
        const second = await OutboxRepository.insert(client, "message:created", testEventPayload("stream_2"))
        const third = await OutboxRepository.insert(client, "message:created", testEventPayload("stream_3"))

        const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
        await client.query("UPDATE outbox SET created_at = $1 WHERE id > $2", [oldDate, baselineId.toString()])

        const deleted = await OutboxRepository.deleteRetainedEvents(client, {
          maxEventId: second.id,
          createdBefore: new Date(Date.now() - 24 * 60 * 60 * 1000),
          limit: 100,
        })

        const remaining = await OutboxRepository.fetchAfterId(client, baselineId, 10)
        const want = {
          deleted: 2,
          remainingEventIds: [third.id],
          remainingEventTypes: ["message:created"],
        }

        expect({
          deleted,
          remainingEventIds: remaining.map((event) => event.id),
          remainingEventTypes: remaining.map((event) => event.eventType),
        }).toEqual(want)
      })
    })

    test("should respect batch limit", async () => {
      await withTestTransaction(pool, async (client) => {
        const baselineResult = await client.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
        const baselineId = BigInt(baselineResult.rows[0].max_id)

        let latestId = baselineId
        for (let i = 0; i < 5; i++) {
          const inserted = await OutboxRepository.insert(client, "message:created", testEventPayload(`stream_${i}`))
          latestId = inserted.id
        }

        const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
        await client.query("UPDATE outbox SET created_at = $1 WHERE id > $2", [oldDate, baselineId.toString()])

        const deleted = await OutboxRepository.deleteRetainedEvents(client, {
          maxEventId: latestId,
          createdBefore: new Date(Date.now() - 24 * 60 * 60 * 1000),
          limit: 2,
        })

        const remaining = await OutboxRepository.fetchAfterId(client, baselineId, 10)
        expect({
          deleted,
          remainingCount: remaining.length,
        }).toEqual({
          deleted: 2,
          remainingCount: 3,
        })
      })
    })
  })
})
