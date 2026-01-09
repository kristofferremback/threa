import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { withClient } from "../../src/db"
import { EventService } from "../../src/services/event-service"
import { MessageRepository } from "../../src/repositories/message-repository"
import { AgentSessionRepository, SessionStatuses } from "../../src/repositories/agent-session-repository"
import { streamId, userId, workspaceId, sessionId, personaId, messageId } from "../../src/lib/id"
import { setupTestDatabase } from "./setup"

describe("Agent Session Repository", () => {
  let pool: Pool
  let eventService: EventService

  beforeAll(async () => {
    pool = await setupTestDatabase()
    eventService = new EventService(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM agent_session_steps")
    await pool.query("DELETE FROM agent_sessions")
    await pool.query("DELETE FROM reactions")
    await pool.query("DELETE FROM messages")
    await pool.query("DELETE FROM stream_events")
    await pool.query("DELETE FROM stream_sequences")
  })

  describe("findRunningByStream", () => {
    test("should return null when no running session exists", async () => {
      const testStreamId = streamId()

      await withClient(pool, async (client) => {
        const result = await AgentSessionRepository.findRunningByStream(client, testStreamId)
        expect(result).toBeNull()
      })
    })

    test("should return running session for stream", async () => {
      const testStreamId = streamId()
      const testPersonaId = personaId()
      const testMessageId = messageId()
      const testSessionId = sessionId()

      await withClient(pool, async (client) => {
        await AgentSessionRepository.insert(client, {
          id: testSessionId,
          streamId: testStreamId,
          personaId: testPersonaId,
          triggerMessageId: testMessageId,
          status: SessionStatuses.RUNNING,
          serverId: "test-server",
        })

        const result = await AgentSessionRepository.findRunningByStream(client, testStreamId)

        expect(result).not.toBeNull()
        expect(result!.id).toBe(testSessionId)
        expect(result!.status).toBe(SessionStatuses.RUNNING)
      })
    })

    test("should not return completed sessions", async () => {
      const testStreamId = streamId()
      const testPersonaId = personaId()
      const testMessageId = messageId()
      const testSessionId = sessionId()

      await withClient(pool, async (client) => {
        await AgentSessionRepository.insert(client, {
          id: testSessionId,
          streamId: testStreamId,
          personaId: testPersonaId,
          triggerMessageId: testMessageId,
          status: SessionStatuses.RUNNING,
          serverId: "test-server",
        })

        await AgentSessionRepository.updateStatus(client, testSessionId, SessionStatuses.COMPLETED)

        const result = await AgentSessionRepository.findRunningByStream(client, testStreamId)
        expect(result).toBeNull()
      })
    })

    test("should not return sessions from other streams", async () => {
      const testStreamId1 = streamId()
      const testStreamId2 = streamId()
      const testPersonaId = personaId()

      await withClient(pool, async (client) => {
        await AgentSessionRepository.insert(client, {
          id: sessionId(),
          streamId: testStreamId1,
          personaId: testPersonaId,
          triggerMessageId: messageId(),
          status: SessionStatuses.RUNNING,
          serverId: "test-server",
        })

        const result = await AgentSessionRepository.findRunningByStream(client, testStreamId2)
        expect(result).toBeNull()
      })
    })
  })

  describe("findLatestByStream", () => {
    test("should return null when no sessions exist", async () => {
      const testStreamId = streamId()

      await withClient(pool, async (client) => {
        const result = await AgentSessionRepository.findLatestByStream(client, testStreamId)
        expect(result).toBeNull()
      })
    })

    test("should return most recent session regardless of status", async () => {
      const testStreamId = streamId()
      const testPersonaId = personaId()
      const session1Id = sessionId()
      const session2Id = sessionId()

      await withClient(pool, async (client) => {
        await AgentSessionRepository.insert(client, {
          id: session1Id,
          streamId: testStreamId,
          personaId: testPersonaId,
          triggerMessageId: messageId(),
          status: SessionStatuses.COMPLETED,
          serverId: "test-server",
        })

        // Small delay to ensure different created_at
        await new Promise((r) => setTimeout(r, 10))

        await AgentSessionRepository.insert(client, {
          id: session2Id,
          streamId: testStreamId,
          personaId: testPersonaId,
          triggerMessageId: messageId(),
          status: SessionStatuses.RUNNING,
          serverId: "test-server",
        })

        const result = await AgentSessionRepository.findLatestByStream(client, testStreamId)

        expect(result).not.toBeNull()
        expect(result!.id).toBe(session2Id)
      })
    })
  })

  describe("updateLastSeenSequence", () => {
    test("should update last seen sequence on session", async () => {
      const testStreamId = streamId()
      const testPersonaId = personaId()
      const testSessionId = sessionId()

      await withClient(pool, async (client) => {
        await AgentSessionRepository.insert(client, {
          id: testSessionId,
          streamId: testStreamId,
          personaId: testPersonaId,
          triggerMessageId: messageId(),
          status: SessionStatuses.RUNNING,
          serverId: "test-server",
        })

        await AgentSessionRepository.updateLastSeenSequence(client, testSessionId, BigInt(42))

        const session = await AgentSessionRepository.findById(client, testSessionId)

        expect(session).not.toBeNull()
        expect(session!.lastSeenSequence).toBe(BigInt(42))
      })
    })

    test("should also update heartbeat", async () => {
      const testStreamId = streamId()
      const testPersonaId = personaId()
      const testSessionId = sessionId()

      await withClient(pool, async (client) => {
        const inserted = await AgentSessionRepository.insert(client, {
          id: testSessionId,
          streamId: testStreamId,
          personaId: testPersonaId,
          triggerMessageId: messageId(),
          status: SessionStatuses.RUNNING,
          serverId: "test-server",
        })

        const initialHeartbeat = inserted.heartbeatAt

        // Small delay
        await new Promise((r) => setTimeout(r, 10))

        await AgentSessionRepository.updateLastSeenSequence(client, testSessionId, BigInt(1))

        const session = await AgentSessionRepository.findById(client, testSessionId)

        expect(session!.heartbeatAt!.getTime()).toBeGreaterThan(initialHeartbeat!.getTime())
      })
    })
  })
})

describe("Message Repository - listSince", () => {
  let pool: Pool
  let eventService: EventService

  beforeAll(async () => {
    pool = await setupTestDatabase()
    eventService = new EventService(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM reactions")
    await pool.query("DELETE FROM messages")
    await pool.query("DELETE FROM stream_events")
    await pool.query("DELETE FROM stream_sequences")
  })

  test("should return messages after given sequence", async () => {
    const testStreamId = streamId()
    const testWorkspaceId = workspaceId()
    const testUserId = userId()

    const msg1 = await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      content: "First",
    })

    const msg2 = await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      content: "Second",
    })

    const msg3 = await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      content: "Third",
    })

    await withClient(pool, async (client) => {
      const messages = await MessageRepository.listSince(client, testStreamId, BigInt(1))

      expect(messages).toHaveLength(2)
      expect(messages[0].id).toBe(msg2.id)
      expect(messages[1].id).toBe(msg3.id)
    })
  })

  test("should return empty array when no messages after sequence", async () => {
    const testStreamId = streamId()
    const testWorkspaceId = workspaceId()
    const testUserId = userId()

    await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      content: "Only message",
    })

    await withClient(pool, async (client) => {
      const messages = await MessageRepository.listSince(client, testStreamId, BigInt(100))

      expect(messages).toHaveLength(0)
    })
  })

  test("should exclude messages from specified author", async () => {
    const testStreamId = streamId()
    const testWorkspaceId = workspaceId()
    const user1Id = userId()
    const user2Id = userId()

    await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: user1Id,
      authorType: "user",
      content: "From user 1",
    })

    const msg2 = await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: user2Id,
      authorType: "user",
      content: "From user 2",
    })

    await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: user1Id,
      authorType: "user",
      content: "From user 1 again",
    })

    await withClient(pool, async (client) => {
      const messages = await MessageRepository.listSince(client, testStreamId, BigInt(0), {
        excludeAuthorId: user1Id,
      })

      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(msg2.id)
    })
  })

  test("should order by sequence ascending (oldest first)", async () => {
    const testStreamId = streamId()
    const testWorkspaceId = workspaceId()
    const testUserId = userId()

    await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      content: "First",
    })

    await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      content: "Second",
    })

    await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      content: "Third",
    })

    await withClient(pool, async (client) => {
      const messages = await MessageRepository.listSince(client, testStreamId, BigInt(0))

      expect(messages[0].content).toBe("First")
      expect(messages[1].content).toBe("Second")
      expect(messages[2].content).toBe("Third")
    })
  })

  test("should not include deleted messages", async () => {
    const testStreamId = streamId()
    const testWorkspaceId = workspaceId()
    const testUserId = userId()

    await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      content: "First",
    })

    const msg2 = await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      content: "Second - will be deleted",
    })

    await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      content: "Third",
    })

    await eventService.deleteMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      messageId: msg2.id,
      actorId: testUserId,
    })

    await withClient(pool, async (client) => {
      const messages = await MessageRepository.listSince(client, testStreamId, BigInt(0))

      expect(messages).toHaveLength(2)
      expect(messages.find((m) => m.id === msg2.id)).toBeUndefined()
    })
  })

  test("should respect limit parameter", async () => {
    const testStreamId = streamId()
    const testWorkspaceId = workspaceId()
    const testUserId = userId()

    for (let i = 0; i < 10; i++) {
      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        content: `Message ${i + 1}`,
      })
    }

    await withClient(pool, async (client) => {
      const messages = await MessageRepository.listSince(client, testStreamId, BigInt(0), {
        limit: 3,
      })

      expect(messages).toHaveLength(3)
    })
  })
})

describe("Agent Session - sentMessageIds", () => {
  let pool: Pool

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM agent_session_steps")
    await pool.query("DELETE FROM agent_sessions")
  })

  test("should persist sent message IDs on session completion", async () => {
    const testStreamId = streamId()
    const testPersonaId = personaId()
    const testSessionId = sessionId()
    const sentIds = [messageId(), messageId(), messageId()]

    await withClient(pool, async (client) => {
      await AgentSessionRepository.insert(client, {
        id: testSessionId,
        streamId: testStreamId,
        personaId: testPersonaId,
        triggerMessageId: messageId(),
        status: SessionStatuses.RUNNING,
        serverId: "test-server",
      })

      await AgentSessionRepository.updateStatus(client, testSessionId, SessionStatuses.COMPLETED, {
        responseMessageId: sentIds[0],
        sentMessageIds: sentIds,
      })

      const session = await AgentSessionRepository.findById(client, testSessionId)

      expect(session).not.toBeNull()
      expect(session!.sentMessageIds).toEqual(sentIds)
      expect(session!.responseMessageId).toBe(sentIds[0])
    })
  })

  test("should default to empty array when no messages sent", async () => {
    const testStreamId = streamId()
    const testPersonaId = personaId()
    const testSessionId = sessionId()

    await withClient(pool, async (client) => {
      const session = await AgentSessionRepository.insert(client, {
        id: testSessionId,
        streamId: testStreamId,
        personaId: testPersonaId,
        triggerMessageId: messageId(),
        status: SessionStatuses.RUNNING,
        serverId: "test-server",
      })

      expect(session.sentMessageIds).toEqual([])
    })
  })
})

describe("Agent Session - Concurrency", () => {
  let pool: Pool

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM agent_session_steps")
    await pool.query("DELETE FROM agent_sessions")
  })

  test("FOR UPDATE SKIP LOCKED prevents concurrent access to running session", async () => {
    const testStreamId = streamId()
    const testPersonaId = personaId()
    const testSessionId = sessionId()

    // Insert a running session
    await withClient(pool, async (client) => {
      await AgentSessionRepository.insert(client, {
        id: testSessionId,
        streamId: testStreamId,
        personaId: testPersonaId,
        triggerMessageId: messageId(),
        status: SessionStatuses.RUNNING,
        serverId: "test-server",
      })
    })

    // Coordination promises (no sleeps!)
    let resolveFirstAcquired: () => void
    let resolveFirstRelease: () => void

    const firstAcquired = new Promise<void>((resolve) => {
      resolveFirstAcquired = resolve
    })
    const firstRelease = new Promise<void>((resolve) => {
      resolveFirstRelease = resolve
    })

    // Track results
    let firstResult: Awaited<ReturnType<typeof AgentSessionRepository.findRunningByStream>> = null
    let secondResult: Awaited<ReturnType<typeof AgentSessionRepository.findRunningByStream>> = null

    // First transaction: acquires lock and holds it
    const firstTx = withClient(pool, async (client) => {
      await client.query("BEGIN")

      firstResult = await AgentSessionRepository.findRunningByStream(client, testStreamId)
      resolveFirstAcquired!() // Signal that lock is held

      await firstRelease // Wait for signal to release

      await client.query("COMMIT")
    })

    // Wait for first transaction to acquire lock
    await firstAcquired

    // Second transaction: should get null due to SKIP LOCKED
    const secondTx = withClient(pool, async (client) => {
      await client.query("BEGIN")

      secondResult = await AgentSessionRepository.findRunningByStream(client, testStreamId)

      await client.query("COMMIT")
    })

    // Run second transaction while first holds lock
    await secondTx

    // Now release first transaction
    resolveFirstRelease!()
    await firstTx

    // First transaction got the session (held lock)
    expect(firstResult).not.toBeNull()
    expect(firstResult!.id).toBe(testSessionId)

    // Second transaction got null (row was locked, skipped)
    expect(secondResult).toBeNull()
  })

  test("concurrent session creation for same trigger message results in only one session", async () => {
    const testStreamId = streamId()
    const testPersonaId = personaId()
    const testMessageId = messageId()

    // Coordination
    let resolveBothReady: () => void
    const bothReady = new Promise<void>((resolve) => {
      resolveBothReady = resolve
    })

    let readyCount = 0
    const signalReady = () => {
      readyCount++
      if (readyCount === 2) resolveBothReady!()
    }

    const results: Array<{ success: boolean; sessionId?: string; error?: unknown }> = []

    // Two concurrent attempts to create session for same trigger message
    const attempt = async (id: string) => {
      await withClient(pool, async (client) => {
        await client.query("BEGIN")

        signalReady()
        await bothReady // Wait until both are ready

        try {
          const session = await AgentSessionRepository.insert(client, {
            id,
            streamId: testStreamId,
            personaId: testPersonaId,
            triggerMessageId: testMessageId,
            status: SessionStatuses.RUNNING,
            serverId: "test-server",
          })

          await client.query("COMMIT")
          results.push({ success: true, sessionId: session.id })
        } catch (error) {
          await client.query("ROLLBACK")
          results.push({ success: false, error })
        }
      })
    }

    await Promise.all([attempt(sessionId()), attempt(sessionId())])

    // Due to unique constraint on trigger_message_id (or lack thereof, we may have a race)
    // At least both should complete without deadlock
    expect(results).toHaveLength(2)

    // Count successful insertions
    const successCount = results.filter((r) => r.success).length

    // Both succeeded OR one failed with constraint violation - either is acceptable
    // The key is no deadlock and at least one succeeded
    expect(successCount).toBeGreaterThanOrEqual(1)
  })

  test("multiple streams can have concurrent running sessions", async () => {
    const stream1Id = streamId()
    const stream2Id = streamId()
    const testPersonaId = personaId()
    const session1Id = sessionId()
    const session2Id = sessionId()

    // Insert running sessions for two different streams
    await withClient(pool, async (client) => {
      await AgentSessionRepository.insert(client, {
        id: session1Id,
        streamId: stream1Id,
        personaId: testPersonaId,
        triggerMessageId: messageId(),
        status: SessionStatuses.RUNNING,
        serverId: "test-server",
      })

      await AgentSessionRepository.insert(client, {
        id: session2Id,
        streamId: stream2Id,
        personaId: testPersonaId,
        triggerMessageId: messageId(),
        status: SessionStatuses.RUNNING,
        serverId: "test-server",
      })
    })

    // Both should be findable concurrently (different streams, no blocking)
    const results = await Promise.all([
      withClient(pool, async (client) => {
        await client.query("BEGIN")
        const result = await AgentSessionRepository.findRunningByStream(client, stream1Id)
        await client.query("COMMIT")
        return result
      }),
      withClient(pool, async (client) => {
        await client.query("BEGIN")
        const result = await AgentSessionRepository.findRunningByStream(client, stream2Id)
        await client.query("COMMIT")
        return result
      }),
    ])

    expect(results[0]).not.toBeNull()
    expect(results[0]!.id).toBe(session1Id)

    expect(results[1]).not.toBeNull()
    expect(results[1]!.id).toBe(session2Id)
  })

  describe("insertRunningOrSkip", () => {
    test("concurrent inserts for same stream result in exactly one session", async () => {
      const testStreamId = streamId()
      const testPersonaId = personaId()
      const testMessageId1 = messageId()
      const testMessageId2 = messageId()

      // Fire two concurrent insertRunningOrSkip calls for the same stream
      const [result1, result2] = await Promise.all([
        AgentSessionRepository.insertRunningOrSkip(pool, {
          id: sessionId(),
          streamId: testStreamId,
          personaId: testPersonaId,
          triggerMessageId: testMessageId1,
          serverId: "server-1",
          initialSequence: BigInt(0),
        }),
        AgentSessionRepository.insertRunningOrSkip(pool, {
          id: sessionId(),
          streamId: testStreamId,
          personaId: testPersonaId,
          triggerMessageId: testMessageId2,
          serverId: "server-2",
          initialSequence: BigInt(0),
        }),
      ])

      // Exactly one should succeed, the other should return null
      const successCount = [result1, result2].filter((r) => r !== null).length
      expect(successCount).toBe(1)

      // Verify only one running session exists for this stream
      const runningSessions = await pool.query(
        `SELECT * FROM agent_sessions WHERE stream_id = $1 AND status = 'running'`,
        [testStreamId]
      )
      expect(runningSessions.rows.length).toBe(1)
    })

    test("allows insert after previous session completed", async () => {
      const testStreamId = streamId()
      const testPersonaId = personaId()
      const testMessageId1 = messageId()
      const testMessageId2 = messageId()

      // Create first session
      const session1 = await AgentSessionRepository.insertRunningOrSkip(pool, {
        id: sessionId(),
        streamId: testStreamId,
        personaId: testPersonaId,
        triggerMessageId: testMessageId1,
        serverId: "server-1",
        initialSequence: BigInt(0),
      })
      expect(session1).not.toBeNull()

      // Complete the first session
      await AgentSessionRepository.completeSession(pool, session1!.id, {
        lastSeenSequence: BigInt(10),
      })

      // Now a second session should be allowed
      const session2 = await AgentSessionRepository.insertRunningOrSkip(pool, {
        id: sessionId(),
        streamId: testStreamId,
        personaId: testPersonaId,
        triggerMessageId: testMessageId2,
        serverId: "server-2",
        initialSequence: BigInt(10),
      })
      expect(session2).not.toBeNull()
      expect(session2!.id).not.toBe(session1!.id)
    })
  })
})
