import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AttachmentList } from "./attachment-list"
import type { AttachmentSummary } from "@threa/types"

// Mock the attachments API
const mockGetDownloadUrl = vi.fn()
vi.mock("@/api", () => ({
  attachmentsApi: {
    getDownloadUrl: (...args: unknown[]) => mockGetDownloadUrl(...args),
  },
}))

describe("AttachmentList", () => {
  const workspaceId = "ws_123"

  beforeEach(() => {
    mockGetDownloadUrl.mockReset()
    mockGetDownloadUrl.mockResolvedValue("https://example.com/download")
  })

  const createAttachment = (overrides: Partial<AttachmentSummary> = {}): AttachmentSummary => ({
    id: "attach_abc123",
    filename: "document.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    ...overrides,
  })

  describe("rendering", () => {
    it("should render nothing when attachments is empty", () => {
      const { container } = render(<AttachmentList attachments={[]} workspaceId={workspaceId} />)
      expect(container.firstChild).toBeNull()
    })

    it("should render nothing when attachments is undefined", () => {
      const { container } = render(
        <AttachmentList attachments={undefined as unknown as AttachmentSummary[]} workspaceId={workspaceId} />
      )
      expect(container.firstChild).toBeNull()
    })

    it("should render file attachment with filename", () => {
      const attachment = createAttachment({ filename: "report.pdf" })
      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      expect(screen.getByText("report.pdf")).toBeInTheDocument()
    })

    it("should render multiple file attachments", () => {
      const attachments = [
        createAttachment({ id: "1", filename: "file1.pdf" }),
        createAttachment({ id: "2", filename: "file2.txt", mimeType: "text/plain" }),
      ]
      render(<AttachmentList attachments={attachments} workspaceId={workspaceId} />)

      expect(screen.getByText("file1.pdf")).toBeInTheDocument()
      expect(screen.getByText("file2.txt")).toBeInTheDocument()
    })

    it("should render image attachments as thumbnails", async () => {
      const attachment = createAttachment({
        id: "img_1",
        filename: "photo.png",
        mimeType: "image/png",
      })
      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      // Image thumbnail should load
      await waitFor(() => {
        expect(mockGetDownloadUrl).toHaveBeenCalledWith(workspaceId, "img_1")
      })

      // Should show filename in overlay
      expect(screen.getByText("photo.png")).toBeInTheDocument()
    })

    it("should separate images and files into different groups", async () => {
      const attachments = [
        createAttachment({ id: "1", filename: "photo.jpg", mimeType: "image/jpeg" }),
        createAttachment({ id: "2", filename: "doc.pdf", mimeType: "application/pdf" }),
      ]
      render(<AttachmentList attachments={attachments} workspaceId={workspaceId} />)

      // Both should be rendered
      await waitFor(() => {
        expect(screen.getByText("photo.jpg")).toBeInTheDocument()
      })
      expect(screen.getByText("doc.pdf")).toBeInTheDocument()
    })
  })

  describe("file size formatting", () => {
    it("should display bytes for small files", () => {
      const attachment = createAttachment({ sizeBytes: 500 })
      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      expect(screen.getByText("500 B")).toBeInTheDocument()
    })

    it("should display KB for files over 1KB", () => {
      const attachment = createAttachment({ sizeBytes: 2048 })
      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      expect(screen.getByText("2.0 KB")).toBeInTheDocument()
    })

    it("should display MB for files over 1MB", () => {
      const attachment = createAttachment({ sizeBytes: 5 * 1024 * 1024 })
      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      expect(screen.getByText("5.0 MB")).toBeInTheDocument()
    })

    it("should display fractional KB", () => {
      const attachment = createAttachment({ sizeBytes: 1536 }) // 1.5 KB
      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      expect(screen.getByText("1.5 KB")).toBeInTheDocument()
    })
  })

  describe("file download", () => {
    it("should trigger download when file attachment clicked", async () => {
      const attachment = createAttachment({ mimeType: "text/plain", filename: "notes.txt" })
      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      // Set up download mocks after render to avoid interfering with React
      const originalCreateElement = document.createElement.bind(document)
      const clickSpy = vi.fn()
      vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
        const element = originalCreateElement(tagName)
        if (tagName === "a") {
          element.click = clickSpy
        }
        return element
      })

      const button = screen.getByRole("button")
      fireEvent.click(button)

      await waitFor(() => {
        expect(clickSpy).toHaveBeenCalled()
      })

      vi.restoreAllMocks()
    })

    it("should open PDF in new tab", async () => {
      const attachment = createAttachment({ mimeType: "application/pdf" })
      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null)

      const button = screen.getByRole("button")
      fireEvent.click(button)

      await waitFor(() => {
        expect(windowOpen).toHaveBeenCalledWith("https://example.com/download", "_blank")
      })

      windowOpen.mockRestore()
    })
  })

  describe("image lightbox", () => {
    it("should open lightbox when image is clicked", async () => {
      const user = userEvent.setup()
      const attachment = createAttachment({
        id: "img_1",
        filename: "photo.png",
        mimeType: "image/png",
      })
      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      // Wait for image to load (button becomes enabled)
      const imageButton = await screen.findByRole("button")
      await waitFor(() => {
        expect(imageButton).not.toBeDisabled()
      })

      await user.click(imageButton)

      // Lightbox should open with dialog
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })
    })

    it("should close lightbox when close button is clicked", async () => {
      const user = userEvent.setup()
      const attachment = createAttachment({
        id: "img_1",
        filename: "photo.png",
        mimeType: "image/png",
      })
      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      // Wait for image to load (button becomes enabled)
      const imageButton = await screen.findByRole("button")
      await waitFor(() => {
        expect(imageButton).not.toBeDisabled()
      })

      await user.click(imageButton)

      // Wait for dialog to open
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument()
      })

      // Click close button (DialogContent has its own, use first one)
      const closeButtons = screen.getAllByRole("button", { name: /close/i })
      await user.click(closeButtons[0])

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })
    })
  })

  describe("error handling", () => {
    it("should show error state when image fails to load", async () => {
      mockGetDownloadUrl.mockRejectedValue(new Error("Failed to load"))

      const attachment = createAttachment({
        id: "img_1",
        filename: "broken.png",
        mimeType: "image/png",
      })
      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      // Wait for error state to appear
      expect(await screen.findByText("Failed to load image")).toBeInTheDocument()
    })
  })
})
