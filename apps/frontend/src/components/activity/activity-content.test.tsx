import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@/test"
import { ActivityContent } from "./activity-content"

vi.mock("@/components/relative-time", () => ({
  RelativeTime: ({ date, className }: { date: string; className?: string }) => (
    <time className={className}>{date}</time>
  ),
}))

const baseProps = {
  actorName: "Github bot",
  streamName: "#gh-notifications",
  activityType: "message",
  createdAt: "2026-04-14T22:00:00Z",
  isUnread: false,
}

describe("ActivityContent", () => {
  it("strips markdown formatting from the preview text", () => {
    render(
      <ActivityContent {...baseProps} contentPreview=":white_check_mark: **Deploy Cloudflare succeeded** on `main`" />
    )

    const preview = screen.getByText(/Deploy Cloudflare succeeded/)
    expect(preview.textContent).toContain(":white_check_mark: Deploy Cloudflare succeeded on main")
    expect(preview.textContent).not.toContain("**")
    expect(preview.textContent).not.toContain("`")
  })

  it("collapses newlines so the preview stays on a single line", () => {
    render(<ActivityContent {...baseProps} contentPreview={"line one\n\nline two"} />)

    const preview = screen.getByText(/line one/)
    expect(preview.textContent).toContain("line one line two")
    expect(preview.textContent).not.toContain("\n")
  })

  it("keeps link text but drops markdown link syntax", () => {
    render(
      <ActivityContent
        {...baseProps}
        contentPreview=":rocket: **Staging deployed** — [feat(messaging): metadata](https://example.com/pr/367)"
      />
    )

    const preview = screen.getByText(/Staging deployed/)
    expect(preview.textContent).toContain("feat(messaging): metadata")
    expect(preview.textContent).not.toContain("https://example.com/pr/367")
    expect(preview.textContent).not.toContain("[")
    expect(preview.textContent).not.toContain("](")
  })

  it("hides the preview paragraph when the input is empty", () => {
    const { container } = render(<ActivityContent {...baseProps} contentPreview="" />)

    expect(container.querySelector("p")).toBeNull()
  })

  it("resolves emoji shortcodes when a toEmoji resolver is supplied", () => {
    const toEmoji = (shortcode: string) => ({ wave: "👋", white_check_mark: "✅" })[shortcode] ?? null
    render(
      <ActivityContent
        {...baseProps}
        contentPreview=":wave: hi! :white_check_mark: **Deploy succeeded**"
        toEmoji={toEmoji}
      />
    )

    const preview = screen.getByText(/Deploy succeeded/)
    expect(preview.textContent).toContain("👋 hi! ✅ Deploy succeeded")
    expect(preview.textContent).not.toContain(":wave:")
    expect(preview.textContent).not.toContain(":white_check_mark:")
  })
})
