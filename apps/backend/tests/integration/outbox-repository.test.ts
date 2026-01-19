import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { withTestTransaction } from "./setup"
import { OutboxRepository } from "../../src/repositories"
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
})
