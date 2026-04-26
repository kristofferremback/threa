import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import type { Pool } from "pg"
import { EventService } from "../../src/features/messaging"
import { AgentSessionRepository, SessionStatuses } from "../../src/features/agents"
import { StreamEventRepository, StreamMemberRepository, StreamRepository } from "../../src/features/streams"
import { eventId, personaId, sessionId, streamId, userId, workspaceId } from "../../src/lib/id"
import { addTestMember, setupTestDatabase, testMessageContent } from "./setup"

describe("message move integration", () => {
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
    await pool.query("DELETE FROM stream_persona_participants")
    await pool.query("DELETE FROM stream_members")
    await pool.query("DELETE FROM reactions")
    await pool.query("DELETE FROM messages")
    await pool.query("DELETE FROM stream_events")
    await pool.query("DELETE FROM stream_sequences")
    await pool.query("DELETE FROM streams")
    await pool.query(
      "DELETE FROM outbox WHERE id > (SELECT COALESCE(MAX(last_processed_id), 0) FROM outbox_listeners WHERE listener_id = 'broadcast')"
    )
  })

  test("moves sparse messages and their agent session traces into a direct child thread", async () => {
    const testWorkspaceId = workspaceId()
    const sourceStreamId = streamId()
    const actorWorkosId = userId()
    const actor = await addTestMember(pool, testWorkspaceId, actorWorkosId)

    await StreamRepository.insert(pool, {
      id: sourceStreamId,
      workspaceId: testWorkspaceId,
      type: "scratchpad",
      visibility: "private",
      companionMode: "on",
      createdBy: actor.id,
    })
    await StreamMemberRepository.insert(pool, sourceStreamId, actor.id)

    const target = await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: sourceStreamId,
      authorId: actor.id,
      authorType: "user",
      ...testMessageContent("target"),
    })
    const keep = await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: sourceStreamId,
      authorId: actor.id,
      authorType: "user",
      ...testMessageContent("keep"),
    })
    const movedA = await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: sourceStreamId,
      authorId: actor.id,
      authorType: "persona",
      ...testMessageContent("moved a"),
    })
    const movedB = await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: sourceStreamId,
      authorId: actor.id,
      authorType: "persona",
      ...testMessageContent("moved b"),
    })

    const traceSession = await AgentSessionRepository.insert(pool, {
      id: sessionId(),
      streamId: sourceStreamId,
      personaId: personaId(),
      triggerMessageId: target.id,
      status: SessionStatuses.RUNNING,
    })
    const traceStartedEventId = eventId()
    await StreamEventRepository.insert(pool, {
      id: traceStartedEventId,
      streamId: sourceStreamId,
      eventType: "agent_session:started",
      payload: {
        sessionId: traceSession.id,
        personaId: traceSession.personaId,
        personaName: "Ariadne",
        triggerMessageId: target.id,
        startedAt: traceSession.createdAt.toISOString(),
      },
      actorId: traceSession.personaId,
      actorType: "persona",
    })
    await AgentSessionRepository.completeSession(pool, traceSession.id, {
      lastSeenSequence: movedB.sequence,
      responseMessageId: movedB.id,
      sentMessageIds: [movedA.id, movedB.id],
    })
    const traceCompletedEventId = eventId()
    await StreamEventRepository.insert(pool, {
      id: traceCompletedEventId,
      streamId: sourceStreamId,
      eventType: "agent_session:completed",
      payload: {
        sessionId: traceSession.id,
        stepCount: 0,
        messageCount: 2,
        duration: 100,
        completedAt: new Date().toISOString(),
      },
      actorId: traceSession.personaId,
      actorType: "persona",
    })

    const validation = await eventService.validateMoveMessagesToThread({
      workspaceId: testWorkspaceId,
      sourceStreamId,
      targetMessageId: target.id,
      messageIds: [movedB.id, movedA.id],
      actorId: actor.id,
    })

    const result = await eventService.moveMessagesToThread({
      workspaceId: testWorkspaceId,
      sourceStreamId,
      targetMessageId: target.id,
      messageIds: [movedB.id, movedA.id],
      actorId: actor.id,
      leaseKey: validation.leaseKey,
    })

    expect(result.thread.parentStreamId).toBe(sourceStreamId)
    expect(result.thread.parentMessageId).toBe(target.id)
    expect(result.thread.rootStreamId).toBe(sourceStreamId)
    expect(result.thread.companionMode).toBe("on")

    const sourceEvents = await StreamEventRepository.list(pool, sourceStreamId, { types: ["message_created"] })
    const sourceMessageIds = sourceEvents.map((event) => (event.payload as { messageId: string }).messageId)
    expect(sourceMessageIds).toEqual([target.id, keep.id])

    const threadEvents = await StreamEventRepository.list(pool, result.thread.id, { types: ["message_created"] })
    const threadMessageIds = threadEvents.map((event) => (event.payload as { messageId: string }).messageId)
    expect(threadMessageIds).toEqual([movedA.id, movedB.id])

    const movedTraceSession = await AgentSessionRepository.findById(pool, traceSession.id)
    expect(movedTraceSession?.streamId).toBe(result.thread.id)
    expect(result.removedEventIds).toEqual(expect.arrayContaining([traceStartedEventId, traceCompletedEventId]))

    const sourceTraceEvents = await StreamEventRepository.list(pool, sourceStreamId, {
      types: ["agent_session:started", "agent_session:completed"],
    })
    expect(sourceTraceEvents).toHaveLength(0)

    const threadTraceEvents = await StreamEventRepository.list(pool, result.thread.id, {
      types: ["agent_session:started", "agent_session:completed"],
    })
    expect(threadTraceEvents.map((event) => event.eventType)).toEqual([
      "agent_session:started",
      "agent_session:completed",
    ])
  })

  test("rejects moving a message onto a following message", async () => {
    const testWorkspaceId = workspaceId()
    const sourceStreamId = streamId()
    const actor = await addTestMember(pool, testWorkspaceId, userId())

    await StreamRepository.insert(pool, {
      id: sourceStreamId,
      workspaceId: testWorkspaceId,
      type: "scratchpad",
      visibility: "private",
      companionMode: "off",
      createdBy: actor.id,
    })
    await StreamMemberRepository.insert(pool, sourceStreamId, actor.id)

    const selected = await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: sourceStreamId,
      authorId: actor.id,
      authorType: "user",
      ...testMessageContent("selected"),
    })
    const following = await eventService.createMessage({
      workspaceId: testWorkspaceId,
      streamId: sourceStreamId,
      authorId: actor.id,
      authorType: "user",
      ...testMessageContent("following"),
    })

    await expect(
      eventService.validateMoveMessagesToThread({
        workspaceId: testWorkspaceId,
        sourceStreamId,
        targetMessageId: following.id,
        messageIds: [selected.id],
        actorId: actor.id,
      })
    ).rejects.toThrow("Messages can only be moved onto a preceding message")
  })
})
