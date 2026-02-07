import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { EventItem } from "./event-item"
import type { StreamEvent } from "@threa/types"

// Mock child components to isolate EventItem logic
vi.mock("./message-event", () => ({
  MessageEvent: ({
    event,
    isHighlighted,
  }: {
    event: StreamEvent
    workspaceId: string
    streamId: string
    hideActions?: boolean
    isHighlighted?: boolean
  }) => (
    <div data-testid="message-event" data-highlighted={isHighlighted}>
      {(event.payload as { content: string }).content}
    </div>
  ),
}))

vi.mock("./membership-event", () => ({
  MembershipEvent: () => <div data-testid="membership-event" />,
}))

vi.mock("./system-event", () => ({
  SystemEvent: () => <div data-testid="system-event" />,
}))

const createMessageEvent = (messageId: string, contentMarkdown: string): StreamEvent => ({
  id: `event_${messageId}`,
  streamId: "stream_123",
  sequence: "1",
  eventType: "message_created",
  actorType: "member",
  actorId: "member_123",
  createdAt: new Date().toISOString(),
  payload: { messageId, contentMarkdown },
})

describe("EventItem", () => {
  const workspaceId = "ws_123"
  const streamId = "stream_123"

  describe("highlight behavior", () => {
    it("should pass isHighlighted=true when highlightMessageId matches the message", () => {
      const event = createMessageEvent("msg_target", "Target message")

      render(<EventItem event={event} workspaceId={workspaceId} streamId={streamId} highlightMessageId="msg_target" />)

      const messageEvent = screen.getByTestId("message-event")
      expect(messageEvent).toHaveAttribute("data-highlighted", "true")
    })

    it("should pass isHighlighted=false when highlightMessageId does not match", () => {
      const event = createMessageEvent("msg_other", "Other message")

      render(<EventItem event={event} workspaceId={workspaceId} streamId={streamId} highlightMessageId="msg_target" />)

      const messageEvent = screen.getByTestId("message-event")
      expect(messageEvent).toHaveAttribute("data-highlighted", "false")
    })

    it("should pass isHighlighted=false when highlightMessageId is null", () => {
      const event = createMessageEvent("msg_123", "Some message")

      render(<EventItem event={event} workspaceId={workspaceId} streamId={streamId} highlightMessageId={null} />)

      const messageEvent = screen.getByTestId("message-event")
      expect(messageEvent).toHaveAttribute("data-highlighted", "false")
    })

    it("should pass isHighlighted=false when highlightMessageId is undefined", () => {
      const event = createMessageEvent("msg_123", "Some message")

      render(<EventItem event={event} workspaceId={workspaceId} streamId={streamId} />)

      const messageEvent = screen.getByTestId("message-event")
      expect(messageEvent).toHaveAttribute("data-highlighted", "false")
    })
  })

  describe("event type rendering", () => {
    it("should render MessageEvent for message_created events", () => {
      const event = createMessageEvent("msg_123", "Hello")

      render(<EventItem event={event} workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByTestId("message-event")).toBeInTheDocument()
    })

    it("should render MessageEvent for message_edited events", () => {
      const event: StreamEvent = {
        ...createMessageEvent("msg_123", "Edited"),
        eventType: "message_edited",
      }

      render(<EventItem event={event} workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByTestId("message-event")).toBeInTheDocument()
    })

    it("should render MessageEvent for companion_response events", () => {
      const event: StreamEvent = {
        ...createMessageEvent("msg_123", "AI response"),
        eventType: "companion_response",
        actorType: "persona",
      }

      render(<EventItem event={event} workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByTestId("message-event")).toBeInTheDocument()
    })
  })
})
