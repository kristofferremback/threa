import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AttachmentList } from "./attachment-list"
import type { AttachmentSummary } from "@threa/types"

// Mock the attachments API
vi.mock("@/api", () => ({
  attachmentsApi: {
    getDownloadUrl: vi.fn().mockResolvedValue("https://example.com/download"),
  },
}))

describe("AttachmentList", () => {
  const workspaceId = "ws_123"

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

    it("should render attachment with filename", () => {
      const attachment = createAttachment({ filename: "report.pdf" })
      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      expect(screen.getByText("report.pdf")).toBeInTheDocument()
    })

    it("should render multiple attachments", () => {
      const attachments = [
        createAttachment({ id: "1", filename: "file1.pdf" }),
        createAttachment({ id: "2", filename: "file2.txt" }),
        createAttachment({ id: "3", filename: "image.png" }),
      ]
      render(<AttachmentList attachments={attachments} workspaceId={workspaceId} />)

      expect(screen.getByText("file1.pdf")).toBeInTheDocument()
      expect(screen.getByText("file2.txt")).toBeInTheDocument()
      expect(screen.getByText("image.png")).toBeInTheDocument()
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

  describe("download", () => {
    it("should trigger download when clicked", async () => {
      const attachment = createAttachment()

      // Mock window.open for preview files
      const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null)

      render(<AttachmentList attachments={[attachment]} workspaceId={workspaceId} />)

      const button = screen.getByRole("button")
      fireEvent.click(button)

      // PDF files should open in new tab
      await waitFor(() => {
        expect(windowOpen).toHaveBeenCalledWith("https://example.com/download", "_blank")
      })

      windowOpen.mockRestore()
    })
  })
})
