import { beforeEach, describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ThreadSummary } from "@threa/types"
import * as hooksModule from "@/hooks"
import * as workspaceEmojiModule from "@/hooks/use-workspace-emoji"
import * as relativeTimeModule from "@/components/relative-time"
import { ThreadCard } from "./thread-card"

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(hooksModule, "useActors").mockReturnValue({
    getActorName: (id: string) => `Name-${id.slice(-4)}`,
    getActorAvatar: (id: string) => ({ fallback: id.slice(0, 2).toUpperCase(), avatarUrl: null }),
  } as unknown as ReturnType<typeof hooksModule.useActors>)
  vi.spyOn(workspaceEmojiModule, "useWorkspaceEmoji").mockReturnValue({
    toEmoji: () => null,
  } as unknown as ReturnType<typeof workspaceEmojiModule.useWorkspaceEmoji>)
  vi.spyOn(relativeTimeModule, "RelativeTime").mockImplementation((({ date }: { date: string }) => (
    <time dateTime={date}>{date}</time>
  )) as unknown as typeof relativeTimeModule.RelativeTime)
})

const baseSummary: ThreadSummary = {
  lastReplyAt: "2026-04-19T12:00:00.000Z",
  participants: [
    { id: "user_alice", type: "user" },
    { id: "user_bob", type: "user" },
  ],
  latestReply: {
    messageId: "msg_1",
    actorId: "user_alice",
    actorType: "user",
    contentMarkdown: "**latest** reply content",
  },
}

function renderCard(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe("ThreadCard", () => {
  it("returns null when replyCount is 0", () => {
    const { container } = renderCard(
      <ThreadCard replyCount={0} href="/threads/1" workspaceId="ws_1" summary={undefined} />
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders the singular noun when replyCount is 1", () => {
    renderCard(<ThreadCard replyCount={1} href="/threads/1" workspaceId="ws_1" summary={baseSummary} />)
    expect(screen.getByText("1 reply")).toBeInTheDocument()
    expect(screen.queryByText(/replies$/)).toBeNull()
  })

  it("renders the plural noun when replyCount > 1", () => {
    renderCard(<ThreadCard replyCount={4} href="/threads/1" workspaceId="ws_1" summary={baseSummary} />)
    expect(screen.getByText("4 replies")).toBeInTheDocument()
  })

  it("renders reply count only (no preview row) when summary is absent", () => {
    renderCard(<ThreadCard replyCount={2} href="/threads/1" workspaceId="ws_1" summary={undefined} />)
    expect(screen.getByText("2 replies")).toBeInTheDocument()
    // Preview row renders the latest author's name + ": " separator; confirm
    // it's absent. Matches the "author: content" shape used by
    // StreamItemPreview and ActivityPreview.
    expect(screen.queryByText(/: $/)).toBeNull()
  })

  it("strips markdown from the preview (INV-60)", () => {
    renderCard(<ThreadCard replyCount={3} href="/threads/1" workspaceId="ws_1" summary={baseSummary} />)
    // `truncateContent` routes `**latest**` through `stripMarkdownToInline`.
    // The rendered preview should contain "latest" as plain text, NOT `**latest**`.
    const preview = screen.getByText(/latest/i)
    expect(preview.textContent).not.toContain("**")
  })
})
