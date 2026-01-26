import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MessageEvent } from "./message-event"
import type { StreamEvent } from "@threa/types"

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
  useTrace: () => ({
    getTraceUrl: (sessionId: string) => `/trace/${sessionId}`,
  }),
  createDraftPanelId: (parentStreamId: string, parentMessageId: string) => `draft:${parentStreamId}:${parentMessageId}`,
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
  AttachmentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

vi.mock("@/hooks", () => ({
  useActors: () => ({
    getActorName: (actorId: string | null, actorType: string | null) => {
      if (!actorId) return "Unknown"
      if (actorType === "persona") return "AI Companion"
      return "User Name"
    },
    getActorInitials: (actorId: string | null, actorType: string | null) => {
      if (!actorId) return "?"
      if (actorType === "persona") return "AI"
      return "US"
    },
    getUser: () => undefined,
    getPersona: () => undefined,
  }),
}))

const createMessageEvent = (messageId: string, contentMarkdown: string): StreamEvent => ({
  id: `event_${messageId}`,
  streamId: "stream_123",
  sequence: "1",
  eventType: "message_created",
  actorType: "user",
  actorId: "user_123",
  createdAt: new Date().toISOString(),
  payload: { messageId, contentMarkdown },
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

  describe("AI message styling", () => {
    it("should apply enhanced gold styling to persona messages", () => {
      const event: StreamEvent = {
        ...createMessageEvent("msg_123", "AI response"),
        actorType: "persona",
      }

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      const messageContainer = container.querySelector(".group")
      expect(messageContainer).toHaveClass("border-l-[3px]")
      expect(messageContainer).toHaveClass("border-l-primary")
      expect(messageContainer).toHaveClass("bg-gradient-to-r")
      expect(messageContainer).toHaveClass("from-primary/[0.06]")
    })

    it("should not apply gold border to user messages", () => {
      const event = createMessageEvent("msg_123", "User message")

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      const messageContainer = container.querySelector(".group")
      expect(messageContainer).not.toHaveClass("border-l-[3px]")
      expect(messageContainer).not.toHaveClass("border-l-primary")
    })

    it("should not apply background to user messages", () => {
      const event = createMessageEvent("msg_123", "User message")

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      const messageContainer = container.querySelector(".group")
      expect(messageContainer).not.toHaveClass("bg-gradient-to-br")
      expect(messageContainer).not.toHaveClass("bg-gradient-to-r")
      expect(messageContainer).not.toHaveClass("from-muted/[0.03]")
    })

    it("should apply gold background to persona avatar", () => {
      const event: StreamEvent = {
        ...createMessageEvent("msg_123", "AI response"),
        actorType: "persona",
      }

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      const avatarFallback = container.querySelector("span")
      expect(avatarFallback).toHaveClass("bg-primary")
      expect(avatarFallback).toHaveClass("text-primary-foreground")
    })

    it("should apply muted background to user avatar", () => {
      const event = createMessageEvent("msg_123", "User message")

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      const avatarFallback = container.querySelector("span")
      expect(avatarFallback).toHaveClass("bg-muted")
      expect(avatarFallback).toHaveClass("text-foreground")
    })
  })
})
