import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { withTransaction } from "../../src/db"
import { QueueRepository } from "../../src/repositories/queue-repository"
import { setupTestDatabase } from "./setup"

describe("QueueRepository", () => {
  let pool: Pool

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    // Clean up test data between tests
    await pool.query("DELETE FROM queue_messages WHERE workspace_id LIKE 'ws_test%'")
    await pool.query("DELETE FROM queue_tokens WHERE workspace_id LIKE 'ws_test%'")
  })

  describe("insert", () => {
    test("should insert a message", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()
        const message = await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { foo: "bar" },
          processAfter: now,
          insertedAt: now,
        })

        expect(message.id).toBe("queue_test1")
        expect(message.queueName).toBe("test.queue")
        expect(message.workspaceId).toBe("ws_test")
        expect(message.payload).toEqual({ foo: "bar" })
        expect(message.processAfter).toEqual(now)
        expect(message.insertedAt).toEqual(now)
        expect(message.claimedAt).toBeNull()
        expect(message.claimedBy).toBeNull()
        expect(message.claimedUntil).toBeNull()
        expect(message.claimedCount).toBe(0)
        expect(message.failedCount).toBe(0)
        expect(message.lastError).toBeNull()
        expect(message.dlqAt).toBeNull()
        expect(message.completedAt).toBeNull()
      })
    })
  })

  describe("claimNext", () => {
    test("should claim next available message", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert two messages
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        await QueueRepository.insert(client, {
          id: "queue_test2",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 2 },
          processAfter: new Date(now.getTime() + 1000),
          insertedAt: now,
        })

        // Claim next (should get first one)
        const claimed = await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_test",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        expect(claimed).not.toBeNull()
        expect(claimed!.id).toBe("queue_test1")
        expect(claimed!.claimedBy).toBe("worker_test")
        expect(claimed!.claimedCount).toBe(1)
      })
    })

    test("should return null if no messages available", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        const claimed = await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_test",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        expect(claimed).toBeNull()
      })
    })

    test("should skip messages not ready yet (processAfter > now)", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert message scheduled for future
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: new Date(now.getTime() + 60000), // 1 minute future
          insertedAt: now,
        })

        const claimed = await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_test",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        expect(claimed).toBeNull()
      })
    })

    test("should skip messages with active claims", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert and claim a message
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        const firstClaim = await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_1",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        expect(firstClaim).not.toBeNull()

        // Try to claim again (should skip claimed message)
        const secondClaim = await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_2",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        expect(secondClaim).toBeNull()
      })
    })

    test("should reclaim messages with expired claims", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert message
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        // Claim with expired claimedUntil
        await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_1",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() - 1000), // Already expired
          now,
        })

        // Should be able to reclaim
        const reclaimed = await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_2",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        expect(reclaimed).not.toBeNull()
        expect(reclaimed!.id).toBe("queue_test1")
        expect(reclaimed!.claimedBy).toBe("worker_2")
        expect(reclaimed!.claimedCount).toBe(2) // Incremented on reclaim
      })
    })

    test("should skip completed messages", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert message
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        // Claim and complete
        const claimed = await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_1",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        await QueueRepository.complete(client, {
          messageId: claimed!.id,
          claimedBy: "worker_1",
          completedAt: now,
        })

        // Try to claim again (should not get completed message)
        const secondClaim = await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_2",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        expect(secondClaim).toBeNull()
      })
    })

    test("should skip DLQ messages", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert message
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        // Claim and move to DLQ
        const claimed = await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_1",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        await QueueRepository.failDlq(client, {
          messageId: claimed!.id,
          claimedBy: "worker_1",
          error: "test error",
          dlqAt: now,
        })

        // Try to claim again (should not get DLQ message)
        const secondClaim = await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_2",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        expect(secondClaim).toBeNull()
      })
    })
  })

  describe("renewClaim", () => {
    test("should renew claim for active message", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert and claim message
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_test",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        // Renew claim
        const renewed = await QueueRepository.renewClaim(client, {
          messageId: "queue_test1",
          claimedBy: "worker_test",
          claimedUntil: new Date(now.getTime() + 20000),
        })

        expect(renewed).toBe(true)

        // Verify claim was extended
        const message = await QueueRepository.getById(client, "queue_test1")
        expect(message!.claimedUntil).toEqual(new Date(now.getTime() + 20000))
      })
    })

    test("should fail to renew with wrong claimedBy", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert and claim message
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_1",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        // Try to renew with different worker
        const renewed = await QueueRepository.renewClaim(client, {
          messageId: "queue_test1",
          claimedBy: "worker_2",
          claimedUntil: new Date(now.getTime() + 20000),
        })

        expect(renewed).toBe(false)
      })
    })

    test("should fail to renew completed message", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert, claim, and complete message
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_test",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        await QueueRepository.complete(client, {
          messageId: "queue_test1",
          claimedBy: "worker_test",
          completedAt: now,
        })

        // Try to renew completed message
        const renewed = await QueueRepository.renewClaim(client, {
          messageId: "queue_test1",
          claimedBy: "worker_test",
          claimedUntil: new Date(now.getTime() + 20000),
        })

        expect(renewed).toBe(false)
      })
    })
  })

  describe("complete", () => {
    test("should mark message as completed", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert and claim message
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_test",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        // Complete
        await QueueRepository.complete(client, {
          messageId: "queue_test1",
          claimedBy: "worker_test",
          completedAt: now,
        })

        // Verify completion
        const message = await QueueRepository.getById(client, "queue_test1")
        expect(message!.completedAt).toEqual(now)
        expect(message!.claimedBy).toBeNull()
        expect(message!.claimedUntil).toBeNull()
      })
    })

    test("should throw if wrong claimedBy", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert and claim message
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_1",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        // Try to complete with different worker
        await expect(
          QueueRepository.complete(client, {
            messageId: "queue_test1",
            claimedBy: "worker_2",
            completedAt: now,
          })
        ).rejects.toThrow()
      })
    })
  })

  describe("fail", () => {
    test("should record failure and set retry backoff", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()
        const retryAfter = new Date(now.getTime() + 5000)

        // Insert and claim message
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_test",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        // Fail
        await QueueRepository.fail(client, {
          messageId: "queue_test1",
          claimedBy: "worker_test",
          error: "test error",
          processAfter: retryAfter,
          now,
        })

        // Verify failure recorded
        const message = await QueueRepository.getById(client, "queue_test1")
        expect(message!.failedCount).toBe(1)
        expect(message!.lastError).toBe("test error")
        expect(message!.processAfter).toEqual(retryAfter)
        expect(message!.claimedBy).toBeNull()
        expect(message!.claimedUntil).toBeNull()
      })
    })

    test("should increment failedCount on multiple failures", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert message
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        // Fail twice
        for (let i = 1; i <= 2; i++) {
          const claimed = await QueueRepository.claimNext(client, {
            queueName: "test.queue",
            workspaceId: "ws_test",
            claimedBy: "worker_test",
            claimedAt: now,
            claimedUntil: new Date(now.getTime() + 10000),
            now,
          })

          await QueueRepository.fail(client, {
            messageId: claimed!.id,
            claimedBy: "worker_test",
            error: `error ${i}`,
            processAfter: now,
            now,
          })
        }

        // Verify failedCount
        const message = await QueueRepository.getById(client, "queue_test1")
        expect(message!.failedCount).toBe(2)
      })
    })
  })

  describe("failDlq", () => {
    test("should move message to DLQ", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert and claim message
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_test",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        // Move to DLQ
        await QueueRepository.failDlq(client, {
          messageId: "queue_test1",
          claimedBy: "worker_test",
          error: "fatal error",
          dlqAt: now,
        })

        // Verify DLQ
        const message = await QueueRepository.getById(client, "queue_test1")
        expect(message!.dlqAt).toEqual(now)
        expect(message!.lastError).toBe("fatal error")
        expect(message!.claimedBy).toBeNull()
        expect(message!.claimedUntil).toBeNull()
      })
    })
  })

  describe("unDlq", () => {
    test("should remove message from DLQ and reset for retry", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()

        // Insert, claim, and move to DLQ
        await QueueRepository.insert(client, {
          id: "queue_test1",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: now,
          insertedAt: now,
        })

        await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_test",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        await QueueRepository.failDlq(client, {
          messageId: "queue_test1",
          claimedBy: "worker_test",
          error: "fatal error",
          dlqAt: now,
        })

        // Un-DLQ
        await QueueRepository.unDlq(client, {
          messageId: "queue_test1",
          processAfter: now,
        })

        // Verify removed from DLQ
        const message = await QueueRepository.getById(client, "queue_test1")
        expect(message!.dlqAt).toBeNull()
        expect(message!.failedCount).toBe(0)
        expect(message!.lastError).toBeNull()
        expect(message!.processAfter).toEqual(now)
      })
    })
  })

  describe("deleteOldMessages", () => {
    test("should delete old completed messages", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()
        const oldDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) // 7 days ago

        // Insert and complete old message
        await QueueRepository.insert(client, {
          id: "queue_old",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: oldDate,
          insertedAt: oldDate,
        })

        await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_test",
          claimedAt: oldDate,
          claimedUntil: new Date(oldDate.getTime() + 10000),
          now: oldDate,
        })

        await QueueRepository.complete(client, {
          messageId: "queue_old",
          claimedBy: "worker_test",
          completedAt: oldDate,
        })

        // Insert recent completed message
        await QueueRepository.insert(client, {
          id: "queue_recent",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 2 },
          processAfter: now,
          insertedAt: now,
        })

        await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_test",
          claimedAt: now,
          claimedUntil: new Date(now.getTime() + 10000),
          now,
        })

        await QueueRepository.complete(client, {
          messageId: "queue_recent",
          claimedBy: "worker_test",
          completedAt: now,
        })

        // Delete old messages
        const result = await QueueRepository.deleteOldMessages(client, {
          completedBeforeDate: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 1 day ago
          dlqBeforeDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        })

        expect(result.completedDeleted).toBe(1)

        // Verify old message deleted, recent kept
        const oldMessage = await QueueRepository.getById(client, "queue_old")
        const recentMessage = await QueueRepository.getById(client, "queue_recent")

        expect(oldMessage).toBeNull()
        expect(recentMessage).not.toBeNull()
      })
    })

    test("should delete old DLQ messages", async () => {
      await withTransaction(pool, async (client) => {
        const now = new Date()
        const oldDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) // 7 days ago

        // Insert and move to DLQ (old)
        await QueueRepository.insert(client, {
          id: "queue_old_dlq",
          queueName: "test.queue",
          workspaceId: "ws_test",
          payload: { order: 1 },
          processAfter: oldDate,
          insertedAt: oldDate,
        })

        await QueueRepository.claimNext(client, {
          queueName: "test.queue",
          workspaceId: "ws_test",
          claimedBy: "worker_test",
          claimedAt: oldDate,
          claimedUntil: new Date(oldDate.getTime() + 10000),
          now: oldDate,
        })

        await QueueRepository.failDlq(client, {
          messageId: "queue_old_dlq",
          claimedBy: "worker_test",
          error: "test error",
          dlqAt: oldDate,
        })

        // Delete old DLQ messages
        const result = await QueueRepository.deleteOldMessages(client, {
          completedBeforeDate: now,
          dlqBeforeDate: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 1 day ago
        })

        expect(result.dlqDeleted).toBe(1)

        // Verify deleted
        const message = await QueueRepository.getById(client, "queue_old_dlq")
        expect(message).toBeNull()
      })
    })
  })
})
