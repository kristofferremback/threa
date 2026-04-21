import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { linkPreviewsApi } from "@/api"
import { MessageLinkPreviewCard } from "./message-link-preview-card"
import type { LinkPreviewSummary } from "@threa/types"

const mockResolveMessageLink = vi.fn()

describe("MessageLinkPreviewCard", () => {
  const workspaceId = "ws_123"
  const preview: LinkPreviewSummary = {
    id: "preview_1",
    url: "not a valid url",
    position: 0,
    title: null,
    description: null,
    siteName: null,
    faviconUrl: null,
    imageUrl: null,
    contentType: "message_link",
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    mockResolveMessageLink.mockReset()
    mockResolveMessageLink.mockResolvedValue({
      accessTier: "full",
      deleted: false,
      streamName: "general",
      authorName: "Test User",
      authorAvatarUrl: null,
      contentPreview: "Hello from preview",
    })
    vi.spyOn(linkPreviewsApi, "resolveMessageLink").mockImplementation(
      (...args: Parameters<typeof linkPreviewsApi.resolveMessageLink>) => mockResolveMessageLink(...args)
    )
  })

  it("does not throw when the preview URL is malformed", async () => {
    render(
      <MemoryRouter>
        <MessageLinkPreviewCard preview={preview} workspaceId={workspaceId} />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText("Test User")).toBeInTheDocument()
      expect(screen.getByText("#general")).toBeInTheDocument()
    })

    expect(screen.getByText("Hello from preview")).toBeInTheDocument()
  })
})
