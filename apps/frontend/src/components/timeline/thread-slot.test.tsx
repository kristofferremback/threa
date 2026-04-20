import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { MessageAgentActivity } from "@/hooks"
import type { ThreadSummary } from "@threa/types"
import { ThreadSlot } from "./thread-slot"

vi.mock("react-router-dom", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

vi.mock("@/contexts", () => ({
  useTrace: () => ({ getTraceUrl: (id: string) => `/trace/${id}` }),
}))

vi.mock("@/hooks", () => ({
  getStepLabel: (step: string | null) => (step ? `Step-${step}` : "Thinking"),
  useActors: () => ({
    getActorName: (id: string) => `Name-${id.slice(-4)}`,
    getActorAvatar: (id: string) => ({ fallback: id.slice(0, 2).toUpperCase(), avatarUrl: null }),
  }),
}))

vi.mock("@/hooks/use-workspace-emoji", () => ({
  useWorkspaceEmoji: () => ({ toEmoji: () => null }),
}))

vi.mock("@/components/relative-time", () => ({
  RelativeTime: ({ date }: { date: string }) => <time dateTime={date}>{date}</time>,
}))

function makeActivity(overrides: Partial<MessageAgentActivity> = {}): MessageAgentActivity {
  return {
    sessionId: "session_1",
    personaName: "Ariadne",
    currentStepType: "workspace_search",
    stepCount: 1,
    messageCount: 0,
    substep: null,
    ...overrides,
  }
}

const summary: ThreadSummary = {
  lastReplyAt: "2026-04-19T12:00:00.000Z",
  participants: [{ id: "user_alice", type: "user" }],
  latestReply: {
    messageId: "msg_1",
    actorId: "user_alice",
    actorType: "user",
    contentMarkdown: "first reply",
  },
}

describe("ThreadSlot", () => {
  it("renders nothing when there's no activity and no replies", () => {
    const { container } = render(
      <ThreadSlot activity={undefined} replyCount={0} threadHref={null} summary={undefined} workspaceId="ws_1" />
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders the thinking row when session is active with no replies yet", () => {
    render(
      <ThreadSlot activity={makeActivity()} replyCount={0} threadHref={null} summary={undefined} workspaceId="ws_1" />
    )
    expect(screen.getByText("Ariadne")).toBeInTheDocument()
    expect(screen.getByText(/is step-workspace_search…$/)).toBeInTheDocument()
  })

  it("renders the ThreadCard when replies exist", () => {
    render(
      <ThreadSlot activity={undefined} replyCount={2} threadHref="/thread/1" summary={summary} workspaceId="ws_1" />
    )
    expect(screen.getByText("2 replies")).toBeInTheDocument()
  })

  it("renders the ThreadCard with activity indicator when both are present (mid-session thread)", () => {
    const { container } = render(
      <ThreadSlot
        activity={makeActivity()}
        replyCount={1}
        threadHref="/thread/1"
        summary={summary}
        workspaceId="ws_1"
      />
    )
    expect(screen.getByText("1 reply")).toBeInTheDocument()
    // Card's active dot (animate-ping) is present when `isActive`.
    expect(container.querySelector(".animate-ping")).not.toBeNull()
  })

  it("owns the gold left-line so the card suppresses its own (no double-draw)", () => {
    const { container } = render(
      <ThreadSlot activity={undefined} replyCount={2} threadHref="/thread/1" summary={summary} workspaceId="ws_1" />
    )
    // Exactly one 2px gold line should be in the DOM. The slot's line is a
    // `<span class="w-[2px]">`; the card's `before:` line is a pseudo-element
    // not in the DOM, so we assert the persistent line is present and there
    // is no duplicate.
    const lines = container.querySelectorAll(".w-\\[2px\\]")
    expect(lines.length).toBe(1)
  })

  it("applies the grow-in animation only on the first visible→true transition", () => {
    // On initial mount with visible=true (replies already exist when we first
    // see the component, e.g. a Virtuoso scroll-in), the useEffect's wasRef
    // matches the current value and animation does not fire.
    const { container } = render(
      <ThreadSlot activity={undefined} replyCount={2} threadHref="/thread/1" summary={summary} workspaceId="ws_1" />
    )
    expect(container.querySelector(".animate-thread-grow")).toBeNull()
  })
})
