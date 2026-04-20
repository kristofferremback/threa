import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MessageReactions } from "./message-reactions"

const mockToggleReaction = vi.fn()
const mockToggleByEmoji = vi.fn()

vi.mock("@/hooks", () => ({
  useMessageReactions: () => ({
    toggleReaction: mockToggleReaction,
    toggleByEmoji: mockToggleByEmoji,
  }),
  stripColons: (s: string) => s.replace(/:/g, ""),
}))

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}))

vi.mock("@/hooks/use-workspace-emoji", () => ({
  useWorkspaceEmoji: () => ({ toEmoji: (s: string) => s }),
}))

// Pickers/popovers use portals + Radix; render their triggers only so we can
// assert on the structural chrome (pills, overflow button).
vi.mock("./reaction-emoji-picker", () => ({
  ReactionEmojiPicker: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>,
}))
vi.mock("./all-reactions-popover", () => ({
  AllReactionsPopover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock("./reaction-details", () => ({
  ReactionPillDetails: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe("MessageReactions", () => {
  it("renders nothing when the reactions map is empty", () => {
    const { container } = render(
      <MessageReactions reactions={{}} workspaceId="ws_1" messageId="msg_1" currentUserId="user_me" />
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders a pill per unique shortcode with the correct count", () => {
    render(
      <MessageReactions
        reactions={{ ":tada:": ["user_a", "user_b"], ":fire:": ["user_c"] }}
        workspaceId="ws_1"
        messageId="msg_1"
        currentUserId="user_me"
      />
    )
    // Counts are rendered in <span className="tabular-nums">; query by text.
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  it("marks a pill as 'you reacted' (gold) when the current user is in the reactors list", () => {
    const { container } = render(
      <MessageReactions
        reactions={{ ":tada:": ["user_me", "user_a"] }}
        workspaceId="ws_1"
        messageId="msg_1"
        currentUserId="user_me"
      />
    )
    const reactedPill = container.querySelector("button.border-primary\\/50")
    expect(reactedPill).not.toBeNull()
  })

  it("does not mark a pill as reacted when the current user is absent", () => {
    const { container } = render(
      <MessageReactions
        reactions={{ ":tada:": ["user_a", "user_b"] }}
        workspaceId="ws_1"
        messageId="msg_1"
        currentUserId="user_me"
      />
    )
    // Pills should use the muted (unreacted) class, not primary.
    expect(container.querySelector("button.border-primary\\/50")).toBeNull()
    expect(container.querySelector("button.bg-primary\\/\\[0\\.05\\]")).not.toBeNull()
  })

  it("reaction pills satisfy the ≥26px minimum tap target", () => {
    const { container } = render(
      <MessageReactions
        reactions={{ ":tada:": ["user_a"] }}
        workspaceId="ws_1"
        messageId="msg_1"
        currentUserId={null}
      />
    )
    // Both reaction pills and the add-reaction button encode min-h via Tailwind.
    // We check the class is applied rather than computing pixel heights (jsdom
    // does not run a layout engine, so offsetHeight is 0).
    const pill = container.querySelector("button.min-h-\\[26px\\]")
    expect(pill).not.toBeNull()
  })

  it("renders a +N overflow button when more than 5 distinct reactions exist", () => {
    const many: Record<string, string[]> = {}
    for (let i = 0; i < 8; i++) many[`:emoji_${i}:`] = [`user_${i}`]
    render(<MessageReactions reactions={many} workspaceId="ws_1" messageId="msg_1" currentUserId={null} />)
    expect(screen.getByText("+3")).toBeInTheDocument()
  })
})
