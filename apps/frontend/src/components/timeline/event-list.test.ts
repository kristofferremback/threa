import { describe, it, expect } from "vitest"
import type { StreamEvent } from "@threa/types"
import { groupTimelineItems } from "./event-list"

interface CreateEventParams {
  id: string
  sequence: string
  eventType: StreamEvent["eventType"]
  payload: unknown
}

function createEvent(params: CreateEventParams): StreamEvent {
  return {
    id: params.id,
    streamId: "stream_123",
    sequence: params.sequence,
    eventType: params.eventType,
    payload: params.payload,
    actorId: "persona_system_ariadne",
    actorType: "persona",
    createdAt: "2026-02-19T00:00:00.000Z",
  }
}

function createSessionStartedEvent(
  id: string,
  sequence: string,
  sessionId: string,
  triggerMessageId: string
): StreamEvent {
  return createEvent({
    id,
    sequence,
    eventType: "agent_session:started",
    payload: {
      sessionId,
      personaId: "persona_system_ariadne",
      personaName: "Ariadne",
      triggerMessageId,
      startedAt: "2026-02-19T00:00:00.000Z",
    },
  })
}

function createSessionCompletedEvent(id: string, sequence: string, sessionId: string): StreamEvent {
  return createEvent({
    id,
    sequence,
    eventType: "agent_session:completed",
    payload: {
      sessionId,
      stepCount: 1,
      messageCount: 1,
      duration: 1000,
      completedAt: "2026-02-19T00:00:01.000Z",
    },
  })
}

function createSessionFailedEvent(id: string, sequence: string, sessionId: string): StreamEvent {
  return createEvent({
    id,
    sequence,
    eventType: "agent_session:failed",
    payload: {
      sessionId,
      stepCount: 1,
      error: "failed",
      traceId: sessionId,
      failedAt: "2026-02-19T00:00:02.000Z",
    },
  })
}

describe("groupTimelineItems", () => {
  it("replaces the previous session card when a superseding session starts", () => {
    const events: StreamEvent[] = [
      createSessionStartedEvent("event_s1_started", "1", "session_1", "msg_1"),
      createSessionCompletedEvent("event_s1_completed", "2", "session_1"),
      createSessionStartedEvent("event_s2_started", "3", "session_2", "msg_1"),
      createSessionCompletedEvent("event_s2_completed", "4", "session_2"),
      createSessionFailedEvent("event_s1_failed_late", "5", "session_1"),
    ]

    const items = groupTimelineItems(events, "member_123")
    const sessionGroups = items.filter((item) => item.type === "session_group")

    expect(sessionGroups).toHaveLength(1)
    expect(sessionGroups[0]!.sessionId).toBe("session_2")
    expect(sessionGroups[0]!.sessionVersion).toBe(2)
    expect(sessionGroups[0]!.events.map((event) => event.id)).toEqual(["event_s2_started", "event_s2_completed"])
  })

  it("keeps separate cards for sessions with different trigger messages", () => {
    const events: StreamEvent[] = [
      createSessionStartedEvent("event_s1_started", "1", "session_1", "msg_1"),
      createSessionCompletedEvent("event_s1_completed", "2", "session_1"),
      createSessionStartedEvent("event_s2_started", "3", "session_2", "msg_2"),
      createSessionCompletedEvent("event_s2_completed", "4", "session_2"),
    ]

    const items = groupTimelineItems(events, "member_123")
    const sessionGroups = items.filter((item) => item.type === "session_group")

    expect(sessionGroups).toHaveLength(2)
    expect(sessionGroups.map((group) => group.sessionId)).toEqual(["session_1", "session_2"])
    expect(sessionGroups.map((group) => group.sessionVersion)).toEqual([1, 1])
  })
})
