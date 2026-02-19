import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { AgentSessionStep } from "@threa/types"
import { TraceStep } from "./trace-step"

vi.mock("@/components/relative-time", () => ({
  RelativeTime: () => <span>just now</span>,
}))

function createStep(overrides: Partial<AgentSessionStep> = {}): AgentSessionStep {
  return {
    id: "step_1",
    sessionId: "session_1",
    stepNumber: 1,
    stepType: "reconsidering",
    content: JSON.stringify({
      decision: "kept_previous_response",
      reason: "The message edit only fixed grammar and didn't change the underlying request.",
    }),
    startedAt: "2026-02-19T18:00:00.000Z",
    completedAt: "2026-02-19T18:00:01.000Z",
    ...overrides,
  }
}

describe("TraceStep", () => {
  it("shows explicit keep-response reasoning for supersede no-change decisions", () => {
    render(
      <MemoryRouter>
        <TraceStep step={createStep()} workspaceId="ws_1" streamId="stream_1" />
      </MemoryRouter>
    )

    expect(
      screen.getByText("Kept the previous response unchanged after reconsidering the updated context.")
    ).toBeInTheDocument()
    expect(screen.getByText(/didn't change the underlying request/i)).toBeInTheDocument()
  })

  it("indicates edited messages in reconsideration context", () => {
    render(
      <MemoryRouter>
        <TraceStep
          step={createStep({
            content: JSON.stringify({
              draftResponse: "Original draft",
              newMessages: [
                {
                  messageId: "msg_edited",
                  changeType: "message_edited",
                  authorName: "Kris",
                  authorType: "member",
                  createdAt: "2026-02-19T18:00:00.000Z",
                  content: "Updated message content",
                },
              ],
            }),
          })}
          workspaceId="ws_1"
          streamId="stream_1"
        />
      </MemoryRouter>
    )

    expect(screen.getByText("Message changes arrived:")).toBeInTheDocument()
    expect(screen.getByText("Edited")).toBeInTheDocument()
  })

  it("shows rerun edit context in the initial context step", () => {
    render(
      <MemoryRouter>
        <TraceStep
          step={createStep({
            stepType: "context_received",
            content: JSON.stringify({
              rerunContext: {
                cause: "referenced_message_edited",
                editedMessageId: "msg_follow_up",
                editedMessageBefore: "Include peanuts please",
                editedMessageAfter: "No peanuts please",
              },
              messages: [],
            }),
          })}
          workspaceId="ws_1"
          streamId="stream_1"
        />
      </MemoryRouter>
    )

    expect(screen.getByText("Rerun caused by follow-up message edit")).toBeInTheDocument()
    expect(screen.getByText(/Include peanuts please/)).toBeInTheDocument()
    expect(screen.getByText(/No peanuts please/)).toBeInTheDocument()
  })

  it("renders edited output steps separately from sent output steps", () => {
    render(
      <MemoryRouter>
        <TraceStep
          step={createStep({
            stepType: "message_edited",
            content: "Updated response body",
            messageId: "msg_1",
          })}
          workspaceId="ws_1"
          streamId="stream_1"
        />
      </MemoryRouter>
    )

    expect(screen.getByText("Updated previous message:")).toBeInTheDocument()
    expect(screen.getByText(/Updated response body/)).toBeInTheDocument()
  })
})
