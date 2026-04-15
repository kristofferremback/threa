import { describe, it, expect } from "vitest"
import { render, screen } from "@/test"
import { ActivityPreview } from "./activity-content"

describe("ActivityPreview", () => {
  it("strips markdown formatting from the preview text", () => {
    render(<ActivityPreview contentPreview=":white_check_mark: **Deploy Cloudflare succeeded** on `main`" />)

    const preview = screen.getByText(/Deploy Cloudflare succeeded/)
    expect(preview.textContent).toContain(":white_check_mark: Deploy Cloudflare succeeded on main")
    expect(preview.textContent).not.toContain("**")
    expect(preview.textContent).not.toContain("`")
  })

  it("collapses newlines so the preview stays on a single line", () => {
    render(<ActivityPreview contentPreview={"line one\n\nline two"} />)

    const preview = screen.getByText(/line one/)
    expect(preview.textContent).toContain("line one line two")
    expect(preview.textContent).not.toContain("\n")
  })

  it("keeps link text but drops markdown link syntax", () => {
    render(
      <ActivityPreview contentPreview=":rocket: **Staging deployed** — [feat(messaging): metadata](https://example.com/pr/367)" />
    )

    const preview = screen.getByText(/Staging deployed/)
    expect(preview.textContent).toContain("feat(messaging): metadata")
    expect(preview.textContent).not.toContain("https://example.com/pr/367")
    expect(preview.textContent).not.toContain("[")
    expect(preview.textContent).not.toContain("](")
  })

  it("renders nothing when the input is empty", () => {
    const { container } = render(<ActivityPreview contentPreview="" />)

    expect(container.firstChild).toBeNull()
  })

  it("renders the preview without surrounding quotation marks", () => {
    render(<ActivityPreview contentPreview="Welcome back! What's up?" />)

    const preview = screen.getByText(/Welcome back/)
    expect(preview.textContent).toBe("Welcome back! What's up?")
  })

  it("resolves emoji shortcodes when a toEmoji resolver is supplied", () => {
    const toEmoji = (shortcode: string) => ({ wave: "👋", white_check_mark: "✅" })[shortcode] ?? null
    render(<ActivityPreview contentPreview=":wave: hi! :white_check_mark: **Deploy succeeded**" toEmoji={toEmoji} />)

    const preview = screen.getByText(/Deploy succeeded/)
    expect(preview.textContent).toContain("👋 hi! ✅ Deploy succeeded")
    expect(preview.textContent).not.toContain(":wave:")
    expect(preview.textContent).not.toContain(":white_check_mark:")
  })
})
