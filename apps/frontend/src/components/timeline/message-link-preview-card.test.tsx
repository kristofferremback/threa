import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MessageLinkPreviewCard } from "./message-link-preview-card"
import type { LinkPreviewSummary } from "@threa/types"

const mockResolveMessageLink = vi.fn()

vi.mock("@/api", () => ({
  linkPreviewsApi: {
    resolveMessageLink: (...args: unknown[]) => mockResolveMessageLink(...args),
  },
}))

vi.mock("react-router-dom", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

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
    mockResolveMessageLink.mockReset()
    mockResolveMessageLink.mockResolvedValue({
      accessTier: "full",
      deleted: false,
      streamName: "general",
      authorName: "Test User",
      authorAvatarUrl: null,
      contentPreview: "Hello from preview",
    })
  })

  it("does not throw when the preview URL is malformed", async () => {
    render(<MessageLinkPreviewCard preview={preview} workspaceId={workspaceId} />)

    await waitFor(() => {
      expect(screen.getByText("Test User")).toBeInTheDocument()
      expect(screen.getByText("#general")).toBeInTheDocument()
    })

    expect(screen.getByText("Hello from preview")).toBeInTheDocument()
  })
})
