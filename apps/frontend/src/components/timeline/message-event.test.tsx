import { describe, it, expect, vi, beforeAll } from "vitest"
import { render, screen } from "@testing-library/react"
import { MessageEvent } from "./message-event"
import type { StreamEvent } from "@threa/types"

// Mock scrollIntoView which isn't available in jsdom
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// Mock dependencies
vi.mock("react-router-dom", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

vi.mock("@/contexts", () => ({
  usePendingMessages: () => ({
    getStatus: () => "sent",
    retryMessage: vi.fn(),
  }),
  usePanel: () => ({
    openPanels: [],
    getPanelUrl: (streamId: string) => `/panel/${streamId}`,
    openThreadDraft: vi.fn(),
  }),
}))

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  AvatarFallback: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode
    onClick?: () => void
    className?: string
    variant?: string
    size?: string
  }) => (
    <button onClick={onClick} className={className}>
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/markdown-content", () => ({
  MarkdownContent: ({ content, className }: { content: string; className?: string }) => (
    <div className={className} data-testid="markdown-content">
      {content}
    </div>
  ),
}))

vi.mock("@/components/relative-time", () => ({
  RelativeTime: ({ className }: { date: string; className?: string }) => (
    <span className={className} data-testid="relative-time">
      Just now
    </span>
  ),
}))

vi.mock("./attachment-list", () => ({
  AttachmentList: () => <div data-testid="attachment-list" />,
}))

vi.mock("./thread-indicator", () => ({
  ThreadIndicator: () => <div data-testid="thread-indicator" />,
}))

const createMessageEvent = (messageId: string, content: string): StreamEvent => ({
  id: `event_${messageId}`,
  streamId: "stream_123",
  eventType: "message_created",
  version: 1,
  actorType: "user",
  actorId: "user_123",
  createdAt: new Date().toISOString(),
  payload: { messageId, content },
})

describe("MessageEvent", () => {
  const workspaceId = "ws_123"
  const streamId = "stream_123"

  describe("highlight animation", () => {
    it("should apply animate-highlight-flash class when isHighlighted is true", () => {
      const event = createMessageEvent("msg_123", "Highlighted message")

      const { container } = render(
        <MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} isHighlighted={true} />
      )

      const messageContainer = container.querySelector(".group")
      expect(messageContainer).toHaveClass("animate-highlight-flash")
    })

    it("should not apply animate-highlight-flash class when isHighlighted is false", () => {
      const event = createMessageEvent("msg_123", "Normal message")

      const { container } = render(
        <MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} isHighlighted={false} />
      )

      const messageContainer = container.querySelector(".group")
      expect(messageContainer).not.toHaveClass("animate-highlight-flash")
    })

    it("should not apply animate-highlight-flash class when isHighlighted is not provided", () => {
      const event = createMessageEvent("msg_123", "Normal message")

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      const messageContainer = container.querySelector(".group")
      expect(messageContainer).not.toHaveClass("animate-highlight-flash")
    })
  })

  describe("content rendering", () => {
    it("should render message content", () => {
      const event = createMessageEvent("msg_123", "Hello, world!")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByTestId("markdown-content")).toHaveTextContent("Hello, world!")
    })

    it("should render AI initials for persona messages", () => {
      const event: StreamEvent = {
        ...createMessageEvent("msg_123", "AI response"),
        actorType: "persona",
      }

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByText("AI")).toBeInTheDocument()
    })

    it("should render user initials for user messages", () => {
      const event = createMessageEvent("msg_123", "User message")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByText("US")).toBeInTheDocument()
    })
  })
})
