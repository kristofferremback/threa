import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { AgentSession } from "@threa/types"
import { TraceDialog } from "./trace-dialog"

const mockNavigate = vi.fn()
let mockSessionId = "session_1"
let mockSessionIndex = 0
let mockSteps: Array<{ id: string; stepType: string }> = []

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ workspaceId: "ws_1" }),
  }
})

vi.mock("@/contexts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts")>()
  return {
    ...actual,
    useTrace: () => ({
      sessionId: mockSessionId,
      highlightMessageId: null,
      getTraceUrl: (id: string) => `/trace/${id}`,
      closeTraceModal: vi.fn(),
    }),
  }
})

const relatedSessions: AgentSession[] = [
  {
    id: "session_1",
    streamId: "stream_1",
    personaId: "persona_1",
    triggerMessageId: "msg_1",
    triggerMessageRevision: 1,
    supersedesSessionId: null,
    status: "superseded",
    sentMessageIds: ["msg_a"],
    createdAt: "2026-02-19T10:00:00.000Z",
    completedAt: "2026-02-19T10:01:00.000Z",
  },
  {
    id: "session_2",
    streamId: "stream_1",
    personaId: "persona_1",
    triggerMessageId: "msg_1",
    triggerMessageRevision: 2,
    supersedesSessionId: "session_1",
    rerunContext: {
      cause: "referenced_message_edited",
      editedMessageId: "msg_follow_up_1",
      editedMessageBefore: "Include peanut butter",
      editedMessageAfter: "No peanuts please",
    },
    status: "completed",
    sentMessageIds: ["msg_a"],
    createdAt: "2026-02-19T10:02:00.000Z",
    completedAt: "2026-02-19T10:03:00.000Z",
  },
]

vi.mock("@/hooks/use-agent-trace", () => ({
  useAgentTrace: () => ({
    steps: mockSteps,
    session: relatedSessions[mockSessionIndex],
    relatedSessions,
    persona: { id: "persona_1", name: "Ariadne", avatarUrl: null, avatarEmoji: "🜃" },
    status: relatedSessions[mockSessionIndex].status,
    isLoading: false,
    error: null,
  }),
}))

vi.mock("@/components/relative-time", () => ({
  RelativeTime: () => <span>just now</span>,
}))

describe("TraceDialog", () => {
  it("shows superseded-by version hint for superseded sessions", () => {
    mockSessionId = "session_1"
    mockSessionIndex = 0
    mockSteps = []
    render(<TraceDialog />)

    expect(screen.getByText("Superseded by Version 2")).toBeInTheDocument()
  })

  it("shows rerun reason when session was retriggered by follow-up edit", () => {
    mockSessionId = "session_2"
    mockSessionIndex = 1
    mockSteps = []
    render(<TraceDialog />)

    expect(screen.getByText("Rerun triggered by follow-up message edit")).toBeInTheDocument()
    expect(
      screen.getByText('Edited message changed from "Include peanut butter" to "No peanuts please"')
    ).toBeInTheDocument()
  })

  it("counts message edits as sent responses in footer", () => {
    mockSessionId = "session_2"
    mockSessionIndex = 1
    mockSteps = [
      { id: "step_1", stepType: "thinking" },
      { id: "step_2", stepType: "message_edited" },
      { id: "step_3", stepType: "reconsidering" },
    ]

    render(<TraceDialog />)

    expect(screen.getByText("3 steps • 1 message sent")).toBeInTheDocument()
  })
})
