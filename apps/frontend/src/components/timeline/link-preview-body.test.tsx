import { describe, expect, it, afterEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { LinkPreviewBody, LINK_PREVIEW_BODY_HEIGHT_PX } from "./link-preview-body"

/**
 * jsdom reports `scrollHeight` as 0 for every element, so we stub it with a
 * configurable getter. This lets a test pretend the content overflows (or
 * doesn't) independently of layout.
 */
function stubScrollHeight(value: number) {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight")
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return value
    },
  })
  return () => {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", original)
    } else {
      // @ts-expect-error - restore jsdom default
      delete HTMLElement.prototype.scrollHeight
    }
  }
}

describe("LinkPreviewBody", () => {
  let restoreScrollHeight: (() => void) | null = null

  afterEach(() => {
    restoreScrollHeight?.()
    restoreScrollHeight = null
    vi.restoreAllMocks()
  })

  it("does not render a Show more toggle for content that fits the clamp", () => {
    restoreScrollHeight = stubScrollHeight(LINK_PREVIEW_BODY_HEIGHT_PX - 20)

    render(
      <LinkPreviewBody messageId={undefined} previewId="preview_short">
        <p>Short preview</p>
      </LinkPreviewBody>
    )

    expect(screen.getByText("Short preview")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /show more/i })).not.toBeInTheDocument()
  })

  it("shows a Show more toggle when content overflows the clamp", () => {
    restoreScrollHeight = stubScrollHeight(LINK_PREVIEW_BODY_HEIGHT_PX + 200)

    render(
      <LinkPreviewBody messageId={undefined} previewId="preview_tall">
        <p>Tall preview content</p>
      </LinkPreviewBody>
    )

    expect(screen.getByRole("button", { name: /show more/i })).toBeInTheDocument()
  })

  it("toggles the affordance from Show more to Show less on click", async () => {
    restoreScrollHeight = stubScrollHeight(LINK_PREVIEW_BODY_HEIGHT_PX + 200)
    const user = userEvent.setup()

    render(
      <LinkPreviewBody messageId="msg_1" previewId="preview_tall">
        <p>Tall preview content</p>
      </LinkPreviewBody>
    )

    await user.click(screen.getByRole("button", { name: /show more/i }))

    expect(await screen.findByRole("button", { name: /show less/i })).toBeInTheDocument()
  })
})
