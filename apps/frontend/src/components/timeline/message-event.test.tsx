import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MessageEvent } from "./message-event"
import type { StreamEvent } from "@threa/types"

// Only mock what can't run in jsdom: routing and data-fetching hooks
vi.mock("react-router-dom", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

vi.mock("@/contexts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts")>()
  return {
    ...actual,
    usePendingMessages: () => ({
      getStatus: () => "sent",
      retryMessage: vi.fn(),
    }),
    usePanel: () => ({
      panelId: null,
      getPanelUrl: (streamId: string) => `/panel/${streamId}`,
    }),
    useTrace: () => ({
      getTraceUrl: (sessionId: string) => `/trace/${sessionId}`,
    }),
    usePreferences: () => ({
      preferences: { timezone: "UTC", locale: "en-US" },
    }),
  }
})

vi.mock("@/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks")>()
  return {
    ...actual,
    useActors: () => ({
      getActorName: (_actorId: string | null, actorType: string | null) => {
        if (actorType === "persona") return "Ariadne"
        return "Test User"
      },
      getActorAvatar: (_actorId: string | null, actorType: string | null) => {
        if (actorType === "persona") return { fallback: "🜃", slug: "ariadne" }
        return { fallback: "TU", slug: undefined }
      },
    }),
  }
})

const createMessageEvent = (messageId: string, contentMarkdown: string): StreamEvent => ({
  id: `event_${messageId}`,
  streamId: "stream_123",
  sequence: "1",
  eventType: "message_created",
  actorType: "member",
  actorId: "user_123",
  createdAt: new Date().toISOString(),
  payload: { messageId, contentMarkdown },
})

describe("MessageEvent", () => {
  const workspaceId = "ws_123"
  const streamId = "stream_123"

  describe("highlight animation", () => {
    it("should apply highlight animation when isHighlighted is true", () => {
      const event = createMessageEvent("msg_123", "Highlighted message")

      const { container } = render(
        <MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} isHighlighted={true} />
      )

      const messageContainer = container.querySelector(".message-item")
      expect(messageContainer).toHaveClass("animate-highlight-flash")
    })

    it("should not apply highlight animation by default", () => {
      const event = createMessageEvent("msg_123", "Normal message")

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      const messageContainer = container.querySelector(".message-item")
      expect(messageContainer).not.toHaveClass("animate-highlight-flash")
    })
  })

  describe("content rendering", () => {
    it("should render message content", () => {
      const event = createMessageEvent("msg_123", "Hello, world!")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      // Verify content is visible to user
      expect(screen.getByText("Hello, world!")).toBeInTheDocument()
    })

    it("should render actor name", () => {
      const event = createMessageEvent("msg_123", "Test message")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByText("Test User")).toBeInTheDocument()
    })

    it("should render persona name for AI messages", () => {
      const event: StreamEvent = {
        ...createMessageEvent("msg_123", "AI response"),
        actorType: "persona",
        actorId: "persona_ariadne",
      }

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByText("Ariadne")).toBeInTheDocument()
    })
  })

  describe("visual differentiation", () => {
    it("should render Ariadne SVG icon for persona messages", () => {
      const event: StreamEvent = {
        ...createMessageEvent("msg_123", "AI response"),
        actorType: "persona",
        actorId: "persona_ariadne",
      }

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      // Real AriadneIcon renders an SVG with aria-label
      const ariadneIcon = container.querySelector('svg[aria-label="Ariadne"]')
      expect(ariadneIcon).toBeInTheDocument()
    })

    it("should render user initials for user messages", () => {
      const event = createMessageEvent("msg_123", "User message")

      render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      // User avatar shows initials from getActorAvatar
      expect(screen.getByText("TU")).toBeInTheDocument()
    })

    it("should apply gold accent styling to persona messages", () => {
      const event: StreamEvent = {
        ...createMessageEvent("msg_123", "AI response"),
        actorType: "persona",
      }

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      const messageContainer = container.querySelector(".message-item")
      // Persona messages have gradient background and gold left accent
      expect(messageContainer).toHaveClass("bg-gradient-to-r")
      expect(messageContainer).toHaveClass("from-primary/[0.06]")
    })

    it("should not apply gold styling to user messages", () => {
      const event = createMessageEvent("msg_123", "User message")

      const { container } = render(<MessageEvent event={event} workspaceId={workspaceId} streamId={streamId} />)

      const messageContainer = container.querySelector(".message-item")
      expect(messageContainer).not.toHaveClass("bg-gradient-to-r")
      expect(messageContainer).not.toHaveClass("from-primary/[0.06]")
    })
  })
})
