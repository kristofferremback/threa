import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ThreadSummary } from "@threa/types"
import { ThreadCard } from "./thread-card"

// Real components underneath use Link (react-router) + hooks we don't need to
// exercise for structural behavior. Stub them to a minimal surface.
vi.mock("react-router-dom", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className} data-testid="thread-card-link">
      {children}
    </a>
  ),
}))

vi.mock("@/hooks", () => ({
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

describe("ThreadCard", () => {
  it("returns null when replyCount is 0", () => {
    const { container } = render(<ThreadCard replyCount={0} href="/threads/1" workspaceId="ws_1" summary={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders the singular noun when replyCount is 1", () => {
    render(<ThreadCard replyCount={1} href="/threads/1" workspaceId="ws_1" summary={baseSummary} />)
    expect(screen.getByText("1 reply")).toBeInTheDocument()
    expect(screen.queryByText(/replies$/)).toBeNull()
  })

  it("renders the plural noun when replyCount > 1", () => {
    render(<ThreadCard replyCount={4} href="/threads/1" workspaceId="ws_1" summary={baseSummary} />)
    expect(screen.getByText("4 replies")).toBeInTheDocument()
  })

  it("renders reply count only (no preview row) when summary is absent", () => {
    render(<ThreadCard replyCount={2} href="/threads/1" workspaceId="ws_1" summary={undefined} />)
    expect(screen.getByText("2 replies")).toBeInTheDocument()
    // Preview row renders the latest author's name + separator; confirm it's absent.
    expect(screen.queryByText(/—/)).toBeNull()
  })

  it("strips markdown from the preview (INV-60)", () => {
    render(<ThreadCard replyCount={3} href="/threads/1" workspaceId="ws_1" summary={baseSummary} />)
    // `truncateContent` routes `**latest**` through `stripMarkdownToInline`.
    // The rendered preview should contain "latest" as plain text, NOT `**latest**`.
    const preview = screen.getByText(/latest/i)
    expect(preview.textContent).not.toContain("**")
  })
})
