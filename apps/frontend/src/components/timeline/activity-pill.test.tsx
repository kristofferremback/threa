import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { MessageAgentActivity } from "@/hooks"
import { ActivityPill } from "./activity-pill"

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

describe("ActivityPill", () => {
  it("renders the persona name and the step-derived label with exactly one ellipsis", () => {
    render(<ActivityPill activity={makeActivity()} />)
    expect(screen.getByText("Ariadne")).toBeInTheDocument()
    // `getStepLabel` mock returns "Step-<type>", lowercased by the pill and
    // normalized to end with a single Unicode ellipsis (`…`, not `...…`).
    expect(screen.getByText(/is step-workspace_search…$/)).toBeInTheDocument()
    expect(screen.queryByText(/\.\.\.…/)).toBeNull()
  })

  it("prefers substep text over the step label when present", () => {
    render(<ActivityPill activity={makeActivity({ substep: "reading knowledge base" })} />)
    expect(screen.getByText("reading knowledge base…")).toBeInTheDocument()
    // Step-derived label should not also appear.
    expect(screen.queryByText(/is step-/)).toBeNull()
  })

  it("collapses duplicate trailing ellipses on substep input", () => {
    render(<ActivityPill activity={makeActivity({ substep: "evaluating results..." })} />)
    expect(screen.getByText("evaluating results…")).toBeInTheDocument()
    expect(screen.queryByText(/\.\.\.…/)).toBeNull()
  })

  it("links to the trace URL for the session", () => {
    const { container } = render(<ActivityPill activity={makeActivity()} />)
    const link = container.querySelector("a")
    expect(link).not.toBeNull()
    expect(link!.getAttribute("href")).toBe("/trace/session_1")
  })

  it("includes the gold thread-line + weave shimmer", () => {
    const { container } = render(<ActivityPill activity={makeActivity()} />)
    // The 2px gold left-line mirrors ThreadCard's `before:` line so the
    // pill→card transition extends one continuous thread.
    expect(container.querySelector(".w-\\[2px\\]")).not.toBeNull()
    // The shimmer traveling down that line signals a live session.
    expect(container.querySelector(".animate-thread-weave")).not.toBeNull()
  })
})
