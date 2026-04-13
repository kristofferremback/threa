import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { LinkPreviewList } from "./link-preview-list"
import type { LinkPreviewSummary } from "@threa/types"

const mockGetForMessage = vi.fn()
const mockDismiss = vi.fn()

vi.mock("@/api", () => ({
  linkPreviewsApi: {
    getForMessage: (...args: unknown[]) => mockGetForMessage(...args),
    dismiss: (...args: unknown[]) => mockDismiss(...args),
  },
}))

vi.mock("@/contexts", () => ({
  usePreferences: () => ({
    preferences: { linkPreviewDefault: "open" },
  }),
  useSocket: () => null,
}))

describe("LinkPreviewList", () => {
  const preview: LinkPreviewSummary = {
    id: "preview_1",
    url: "https://example.com/article",
    title: "Preview title",
    description: "Preview description",
    imageUrl: null,
    faviconUrl: null,
    siteName: "Example",
    contentType: "website",
    position: 0,
  }

  beforeEach(() => {
    mockGetForMessage.mockReset()
    mockDismiss.mockReset()
    mockDismiss.mockResolvedValue(undefined)
  })

  it("renders previews from the event payload without fetching per-message preview data", () => {
    render(<LinkPreviewList workspaceId="ws_123" messageId="msg_123" previews={[preview]} />)

    expect(screen.getByText("Preview title")).toBeInTheDocument()
    expect(mockGetForMessage).not.toHaveBeenCalled()
  })
})
