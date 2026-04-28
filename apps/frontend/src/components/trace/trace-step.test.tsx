import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { AgentReconsiderationDecisions, type AgentSessionStep } from "@threa/types"
import { TraceStep } from "./trace-step"
import * as relativeTimeModule from "@/components/relative-time"

function createStep(overrides: Partial<AgentSessionStep> = {}): AgentSessionStep {
  return {
    id: "step_1",
    sessionId: "session_1",
    stepNumber: 1,
    stepType: "reconsidering",
    content: JSON.stringify({
      decision: AgentReconsiderationDecisions.KEPT_PREVIOUS_RESPONSE,
      reason: "The message edit only fixed grammar and didn't change the underlying request.",
    }),
    startedAt: "2026-02-19T18:00:00.000Z",
    completedAt: "2026-02-19T18:00:01.000Z",
    ...overrides,
  }
}

describe("TraceStep", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(relativeTimeModule, "RelativeTime").mockImplementation((() => (
      <span>just now</span>
    )) as unknown as typeof relativeTimeModule.RelativeTime)
  })

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
                  authorType: "user",
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

  it("surfaces the attached context-bag pill and referenced messages on the initial context step", async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <TraceStep
          step={createStep({
            stepType: "context_received",
            content: JSON.stringify({
              messages: [
                {
                  messageId: "msg_trigger",
                  authorName: "Kris",
                  authorType: "user",
                  createdAt: "2026-02-19T18:00:00.000Z",
                  content: "Whats up with this",
                  isTrigger: true,
                },
              ],
              attachedContext: {
                refs: [
                  {
                    streamId: "stream_dm_1",
                    fromMessageId: null,
                    toMessageId: null,
                    source: {
                      displayName: "Pierre",
                      slug: null,
                      type: "dm",
                      itemCount: 50,
                    },
                    messages: [
                      {
                        messageId: "msg_dm_1",
                        authorName: "Pierre",
                        createdAt: "2026-02-19T17:30:00.000Z",
                        content: "AI for Prometheus rules looks great",
                      },
                      {
                        messageId: "msg_dm_2",
                        authorName: "Kris",
                        createdAt: "2026-02-19T17:31:00.000Z",
                        content: "Yeah PromQL queries too",
                      },
                    ],
                  },
                ],
              },
            }),
          })}
          workspaceId="ws_1"
          streamId="stream_1"
        />
      </MemoryRouter>
    )

    expect(screen.getByText("Attached context:")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /50 messages in Pierre/i })).toHaveAttribute(
      "href",
      "/w/ws_1/s/stream_dm_1"
    )

    // Messages are tucked behind a disclosure so the step stays compact;
    // expanding it reveals the actual content fed to the model.
    expect(screen.queryByText(/AI for Prometheus rules looks great/)).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Show 2 messages fed to the model/i }))
    expect(screen.getByText(/AI for Prometheus rules looks great/)).toBeInTheDocument()
    expect(screen.getByText(/PromQL queries too/)).toBeInTheDocument()
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

  it("links workspace memo sources to the memory explorer", async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <TraceStep
          step={createStep({
            stepType: "workspace_search",
            content: JSON.stringify({
              memoCount: 1,
              messageCount: 0,
            }),
            sources: [
              {
                type: "workspace_memo",
                title: "Launch decision memo",
                memoId: "memo_1",
                streamId: "stream_2",
                streamName: "#launch",
              },
            ],
          })}
          workspaceId="ws_1"
          streamId="stream_1"
        />
      </MemoryRouter>
    )

    await user.click(screen.getByRole("button", { name: /sources/i }))

    expect(screen.getByRole("link", { name: "Launch decision memo" })).toHaveAttribute(
      "href",
      "/w/ws_1/memory?memo=memo_1"
    )
  })

  it("renders tool_call args as a pretty-printed code block to prevent overflow", () => {
    // Regression for the case where wide JSON args (e.g. GitHub tool calls
    // with long repo paths) were rendered as a single inline span, which
    // forced the trace dialog to scroll horizontally. The fix renders args
    // in a <pre> with overflow-x-auto so the scroll is contained.
    render(
      <MemoryRouter>
        <TraceStep
          step={createStep({
            stepType: "tool_call",
            content: JSON.stringify({
              tool: "github_list_pull_requests",
              args: { repo: "kristofferremback/threa", path: null, author: null, page: 1 },
            }),
          })}
          workspaceId="ws_1"
          streamId="stream_1"
        />
      </MemoryRouter>
    )

    const code = screen.getByText(/"repo": "kristofferremback\/threa"/)
    const pre = code.closest("pre")
    expect(pre).not.toBeNull()
    expect(pre?.className).toMatch(/overflow-x-auto/)
    // Pretty-printed (multiline) rather than a single long line.
    expect(code.textContent).toContain("\n")
  })

  it("renders workspace_search content that arrives as a raw object without crashing", () => {
    // Regression for the crash where a step row's content was persisted as a
    // JSONB object (bypassing the pre-stringify convention), node-postgres
    // auto-parsed it back to a JS object, and React threw "Objects are not
    // valid as a React child" when the fallback span tried to render it.
    //
    // The wire type says `content?: string` so TypeScript can't warn us, but
    // the runtime value can be either. The defensive path in
    // `parseStructuredContent` + `coerceContentToString` should handle both.
    render(
      <MemoryRouter>
        <TraceStep
          step={createStep({
            stepType: "workspace_search",
            // Raw object content — matches the buggy state produced by an
            // intermediate persistence code-path that forgot to pre-stringify.
            content: { substeps: [{ text: "Planning queries…", at: "2026-04-10T12:00:00Z" }] } as unknown as string,
            completedAt: undefined, // in-progress
          })}
          workspaceId="ws_1"
          streamId="stream_1"
        />
      </MemoryRouter>
    )

    // No throw means the defensive path worked. As a bonus, confirm the
    // substep text is visible — parseStructuredContent should have treated
    // the object as already-parsed and pulled out the substeps.
    expect(screen.getByText("Planning queries…")).toBeInTheDocument()
  })
})
