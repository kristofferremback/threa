import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { linkPreviewsApi } from "@/api"
import * as contextsModule from "@/contexts"
import { LinkPreviewList } from "./link-preview-list"
import type { LinkPreviewSummary } from "@threa/types"

const mockGetForMessage = vi.fn()
const mockDismiss = vi.fn()

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
    vi.restoreAllMocks()
    mockGetForMessage.mockReset()
    mockDismiss.mockReset()
    mockDismiss.mockResolvedValue(undefined)

    vi.spyOn(linkPreviewsApi, "getForMessage").mockImplementation(
      (...args: Parameters<typeof linkPreviewsApi.getForMessage>) => mockGetForMessage(...args)
    )
    vi.spyOn(linkPreviewsApi, "dismiss").mockImplementation((...args: Parameters<typeof linkPreviewsApi.dismiss>) =>
      mockDismiss(...args)
    )
    vi.spyOn(contextsModule, "usePreferences").mockReturnValue({
      preferences: { linkPreviewDefault: "open" },
    } as ReturnType<typeof contextsModule.usePreferences>)
    vi.spyOn(contextsModule, "useSocket").mockReturnValue(null as ReturnType<typeof contextsModule.useSocket>)
  })

  it("renders previews from the event payload without fetching per-message preview data", () => {
    render(<LinkPreviewList workspaceId="ws_123" messageId="msg_123" previews={[preview]} />)

    expect(screen.getByText("Preview title")).toBeInTheDocument()
    expect(mockGetForMessage).not.toHaveBeenCalled()
  })
})
