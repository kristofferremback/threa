import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MessageInput } from "./message-input"

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}))

// Mock hooks
const mockSendMessage = vi.fn()
const mockSaveDraftDebounced = vi.fn()
const mockClearDraft = vi.fn()
const mockAddDraftAttachment = vi.fn()
const mockRemoveDraftAttachment = vi.fn()

// Track pending attachments for useAttachments mock
let mockPendingAttachments: Array<{
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  status: "uploading" | "uploaded" | "error"
  error?: string
}> = []

const mockHandleFileSelect = vi.fn()
const mockRemoveAttachment = vi.fn()
const mockClearAttachments = vi.fn()
const mockRestoreAttachments = vi.fn()

vi.mock("@/hooks", () => ({
  useStreamOrDraft: () => ({ sendMessage: mockSendMessage }),
  useDraftMessage: () => ({
    content: "",
    attachments: [],
    saveDraftDebounced: mockSaveDraftDebounced,
    addAttachment: mockAddDraftAttachment,
    removeAttachment: mockRemoveDraftAttachment,
    clearDraft: mockClearDraft,
  }),
  getDraftMessageKey: () => "test-draft-key",
  useAttachments: () => ({
    pendingAttachments: mockPendingAttachments,
    fileInputRef: { current: null },
    handleFileSelect: mockHandleFileSelect,
    removeAttachment: mockRemoveAttachment,
    uploadedIds: mockPendingAttachments.filter((a) => a.status === "uploaded").map((a) => a.id),
    isUploading: mockPendingAttachments.some((a) => a.status === "uploading"),
    hasFailed: mockPendingAttachments.some((a) => a.status === "error"),
    clear: mockClearAttachments,
    restore: mockRestoreAttachments,
  }),
}))

// Mock RichEditor to simplify testing
vi.mock("@/components/editor", () => ({
  RichEditor: ({
    value,
    onChange,
    onSubmit,
    placeholder,
    disabled,
  }: {
    value: string
    onChange: (v: string) => void
    onSubmit: () => void
    placeholder: string
    disabled: boolean
  }) => (
    <textarea
      data-testid="rich-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.metaKey) onSubmit()
      }}
      placeholder={placeholder}
      disabled={disabled}
    />
  ),
}))

describe("MessageInput", () => {
  const workspaceId = "ws_123"
  const streamId = "stream_456"

  beforeEach(() => {
    vi.clearAllMocks()
    mockSendMessage.mockResolvedValue({})
    mockPendingAttachments = []
  })

  describe("rendering", () => {
    it("should render the message input", () => {
      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByTestId("rich-editor")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument()
    })

    it("should disable send button when no content", () => {
      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      expect(sendButton).toBeDisabled()
    })

    it("should enable send button when content is entered", async () => {
      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const editor = screen.getByTestId("rich-editor")
      await userEvent.type(editor, "Hello world")

      const sendButton = screen.getByRole("button", { name: /send/i })
      expect(sendButton).not.toBeDisabled()
    })
  })

  describe("sending messages", () => {
    it("should call sendMessage when send button is clicked", async () => {
      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const editor = screen.getByTestId("rich-editor")
      await userEvent.type(editor, "Hello world")

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      expect(mockSendMessage).toHaveBeenCalledWith({
        content: "Hello world",
        contentFormat: "markdown",
        attachmentIds: undefined,
      })
    })

    it("should clear draft after sending", async () => {
      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const editor = screen.getByTestId("rich-editor")
      await userEvent.type(editor, "Hello world")

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      expect(mockClearDraft).toHaveBeenCalled()
      expect(mockClearAttachments).toHaveBeenCalled()
    })
  })

  describe("attachment display", () => {
    it("should show pending attachments", () => {
      mockPendingAttachments = [
        {
          id: "attach_123",
          filename: "test.txt",
          mimeType: "text/plain",
          sizeBytes: 1024,
          status: "uploaded",
        },
      ]

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByText("test.txt")).toBeInTheDocument()
      expect(screen.getByText("1.0 KB")).toBeInTheDocument()
    })

    it("should show failed attachment with error state", () => {
      mockPendingAttachments = [
        {
          id: "temp_123",
          filename: "failed.txt",
          mimeType: "text/plain",
          sizeBytes: 1024,
          status: "error",
          error: "Upload failed",
        },
      ]

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByText("failed.txt")).toBeInTheDocument()
      expect(screen.getByText("Failed")).toBeInTheDocument()
    })

    it("should disable send button when uploads have failed", () => {
      mockPendingAttachments = [
        {
          id: "temp_123",
          filename: "failed.txt",
          mimeType: "text/plain",
          sizeBytes: 1024,
          status: "error",
        },
      ]

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      expect(sendButton).toBeDisabled()
    })

    it("should enable send with only uploaded attachments and no text", () => {
      mockPendingAttachments = [
        {
          id: "attach_123",
          filename: "test.txt",
          mimeType: "text/plain",
          sizeBytes: 1024,
          status: "uploaded",
        },
      ]

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      expect(sendButton).not.toBeDisabled()
    })

    it("should include attachment IDs when sending", async () => {
      mockPendingAttachments = [
        {
          id: "attach_123",
          filename: "test.txt",
          mimeType: "text/plain",
          sizeBytes: 1024,
          status: "uploaded",
        },
      ]

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      expect(mockSendMessage).toHaveBeenCalledWith({
        content: " ", // Space for attachment-only messages
        contentFormat: "markdown",
        attachmentIds: ["attach_123"],
      })
    })
  })
})
