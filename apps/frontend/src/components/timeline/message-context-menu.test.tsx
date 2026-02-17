import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MessageContextMenu } from "./message-context-menu"
import type { MessageActionContext } from "./message-actions"

vi.mock("react-router-dom", () => ({
  Link: ({
    to,
    children,
    className,
    onClick,
  }: {
    to: string
    children: React.ReactNode
    className?: string
    onClick?: () => void
  }) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}))

function createContext(overrides: Partial<MessageActionContext> = {}): MessageActionContext {
  return {
    contentMarkdown: "Hello world",
    actorType: "member",
    replyUrl: "/panel/draft:stream_1:msg_1",
    ...overrides,
  }
}

describe("MessageContextMenu", () => {
  it("should render a trigger button with message actions label", () => {
    render(<MessageContextMenu context={createContext()} />)

    expect(screen.getByRole("button", { name: "Message actions" })).toBeInTheDocument()
  })

  it("should show menu items when trigger is clicked", async () => {
    const user = userEvent.setup()
    render(<MessageContextMenu context={createContext()} />)

    await user.click(screen.getByRole("button", { name: "Message actions" }))

    expect(screen.getByText("Reply in thread")).toBeInTheDocument()
    expect(screen.getByText("Copy as Markdown")).toBeInTheDocument()
  })

  it("should render navigation actions as links", async () => {
    const user = userEvent.setup()
    render(<MessageContextMenu context={createContext({ replyUrl: "/panel/thread_123" })} />)

    await user.click(screen.getByRole("button", { name: "Message actions" }))

    const replyLink = screen.getByText("Reply in thread").closest("a")
    expect(replyLink).toHaveAttribute("href", "/panel/thread_123")
  })

  it("should show trace option for persona messages with sessionId", async () => {
    const user = userEvent.setup()
    render(
      <MessageContextMenu
        context={createContext({
          actorType: "persona",
          sessionId: "session_123",
          traceUrl: "/trace/session_123",
        })}
      />
    )

    await user.click(screen.getByRole("button", { name: "Message actions" }))

    const traceLink = screen.getByText("Show trace and sources").closest("a")
    expect(traceLink).toHaveAttribute("href", "/trace/session_123")
  })

  it("should not show trace option for user messages", async () => {
    const user = userEvent.setup()
    render(<MessageContextMenu context={createContext()} />)

    await user.click(screen.getByRole("button", { name: "Message actions" }))

    expect(screen.queryByText("Show trace and sources")).not.toBeInTheDocument()
  })
})
