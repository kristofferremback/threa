import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { StreamEvent } from "@threa/types"
import * as contextsModule from "@/contexts"
import * as relativeTimeModule from "@/components/relative-time"
import { AgentSessionEvent } from "./agent-session-event"

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(contextsModule, "useTrace").mockReturnValue({
    getTraceUrl: (sessionId: string) => `/trace/${sessionId}`,
  } as ReturnType<typeof contextsModule.useTrace>)
  vi.spyOn(relativeTimeModule, "RelativeTime").mockImplementation(() => <span>just now</span>)
})

function createSessionEvent(eventType: StreamEvent["eventType"], payload: unknown): StreamEvent {
  return {
    id: `event_${eventType}`,
    streamId: "stream_1",
    sequence: "1",
    eventType,
    payload,
    actorId: "persona_1",
    actorType: "persona",
    createdAt: "2026-02-19T18:00:00.000Z",
  }
}

function renderEvent(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe("AgentSessionEvent", () => {
  it("shows the session version badge", () => {
    const events: StreamEvent[] = [
      createSessionEvent("agent_session:started", {
        sessionId: "session_2",
        personaId: "persona_1",
        personaName: "Ariadne",
        triggerMessageId: "msg_1",
        startedAt: "2026-02-19T18:00:00.000Z",
      }),
      createSessionEvent("agent_session:completed", {
        sessionId: "session_2",
        stepCount: 1,
        messageCount: 1,
        duration: 1000,
        completedAt: "2026-02-19T18:00:01.000Z",
      }),
    ]

    renderEvent(<AgentSessionEvent events={events} sessionVersion={2} />)

    expect(screen.getByText("Version 2")).toBeInTheDocument()
  })

  it("does not show a version badge for the initial invocation", () => {
    const events: StreamEvent[] = [
      createSessionEvent("agent_session:started", {
        sessionId: "session_1",
        personaId: "persona_1",
        personaName: "Ariadne",
        triggerMessageId: "msg_1",
        startedAt: "2026-02-19T18:00:00.000Z",
      }),
      createSessionEvent("agent_session:completed", {
        sessionId: "session_1",
        stepCount: 1,
        messageCount: 1,
        duration: 1000,
        completedAt: "2026-02-19T18:00:01.000Z",
      }),
    ]

    renderEvent(<AgentSessionEvent events={events} sessionVersion={1} />)

    expect(screen.queryByText("Version 1")).not.toBeInTheDocument()
  })

  it("shows rerun reason when session was retriggered by follow-up edit", () => {
    const events: StreamEvent[] = [
      createSessionEvent("agent_session:started", {
        sessionId: "session_3",
        personaId: "persona_1",
        personaName: "Ariadne",
        triggerMessageId: "msg_1",
        rerunContext: {
          cause: "referenced_message_edited",
          editedMessageId: "msg_follow_up_1",
        },
        startedAt: "2026-02-19T18:00:00.000Z",
      }),
      createSessionEvent("agent_session:completed", {
        sessionId: "session_3",
        stepCount: 1,
        messageCount: 1,
        duration: 1000,
        completedAt: "2026-02-19T18:00:01.000Z",
      }),
    ]

    renderEvent(<AgentSessionEvent events={events} sessionVersion={2} />)

    expect(screen.getByText("Rerun after follow-up message edit • 1 step • 1.0s • 1 message sent")).toBeInTheDocument()
  })
})
