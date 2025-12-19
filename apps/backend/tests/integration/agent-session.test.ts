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
