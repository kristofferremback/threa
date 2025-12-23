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
const mockClearDraft = vi.fn()
const mockClearAttachments = vi.fn()
const mockSetContent = vi.fn()
const mockSetIsSending = vi.fn()
const mockHandleContentChange = vi.fn()
const mockHandleRemoveAttachment = vi.fn()
const mockHandleFileSelect = vi.fn()

// Composer state that tests can modify
let mockComposerState = {
  content: "",
  pendingAttachments: [] as Array<{
    id: string
    filename: string
    mimeType: string
    sizeBytes: number
    status: "uploading" | "uploaded" | "error"
    error?: string
  }>,
  uploadedIds: [] as string[],
  isUploading: false,
  hasFailed: false,
  canSend: false,
  isSending: false,
  isLoaded: true,
}

vi.mock("@/hooks", () => ({
  useStreamOrDraft: () => ({ sendMessage: mockSendMessage }),
  getDraftMessageKey: () => "test-draft-key",
  useDraftComposer: () => ({
    content: mockComposerState.content,
    setContent: mockSetContent,
    handleContentChange: mockHandleContentChange,
    pendingAttachments: mockComposerState.pendingAttachments,
    uploadedIds: mockComposerState.uploadedIds,
    isUploading: mockComposerState.isUploading,
    hasFailed: mockComposerState.hasFailed,
    fileInputRef: { current: null },
    handleFileSelect: mockHandleFileSelect,
    handleRemoveAttachment: mockHandleRemoveAttachment,
    canSend: mockComposerState.canSend,
    isSending: mockComposerState.isSending,
    setIsSending: mockSetIsSending,
    clearDraft: mockClearDraft,
    clearAttachments: mockClearAttachments,
    isLoaded: mockComposerState.isLoaded,
  }),
}))

// Mock MessageComposer
vi.mock("@/components/composer", () => ({
  MessageComposer: ({
    content,
    onContentChange,
    onSubmit,
    canSubmit,
    isSubmitting,
    hasFailed,
    pendingAttachments,
  }: {
    content: string
    onContentChange: (v: string) => void
    onSubmit: () => void
    canSubmit: boolean
    isSubmitting: boolean
    hasFailed: boolean
    pendingAttachments: Array<{ id: string; filename: string; sizeBytes: number; status: string }>
  }) => (
    <div data-testid="message-composer">
      <textarea data-testid="rich-editor" value={content} onChange={(e) => onContentChange(e.target.value)} />
      {pendingAttachments.map((a) => (
        <div key={a.id}>
          <span>{a.filename}</span>
          <span>{a.sizeBytes >= 1024 ? `${(a.sizeBytes / 1024).toFixed(1)} KB` : `${a.sizeBytes} B`}</span>
          {a.status === "error" && <span>Failed</span>}
        </div>
      ))}
      <button onClick={onSubmit} disabled={!canSubmit || hasFailed}>
        {isSubmitting ? "Sending..." : "Send"}
      </button>
    </div>
  ),
}))

describe("MessageInput", () => {
  const workspaceId = "ws_123"
  const streamId = "stream_456"

  beforeEach(() => {
    vi.clearAllMocks()
    mockSendMessage.mockResolvedValue({})
    mockComposerState = {
      content: "",
      pendingAttachments: [],
      uploadedIds: [],
      isUploading: false,
      hasFailed: false,
      canSend: false,
      isSending: false,
      isLoaded: true,
    }
  })

  describe("rendering", () => {
    it("should render the message composer", () => {
      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByTestId("message-composer")).toBeInTheDocument()
      expect(screen.getByTestId("rich-editor")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument()
    })

    it("should disable send button when canSend is false", () => {
      mockComposerState.canSend = false

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      expect(sendButton).toBeDisabled()
    })

    it("should enable send button when canSend is true", () => {
      mockComposerState.canSend = true

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      expect(sendButton).not.toBeDisabled()
    })
  })

  describe("sending messages", () => {
    it("should call sendMessage when send button is clicked", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = "Hello world"

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      expect(mockSendMessage).toHaveBeenCalledWith({
        content: "Hello world",
        contentFormat: "markdown",
        attachmentIds: undefined,
      })
    })

    it("should clear draft and attachments after sending", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = "Hello world"

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      expect(mockClearDraft).toHaveBeenCalled()
      expect(mockClearAttachments).toHaveBeenCalled()
    })

    it("should set isSending state during send", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = "Hello world"

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      // setIsSending(true) called at start
      expect(mockSetIsSending).toHaveBeenCalledWith(true)
      // setIsSending(false) called in finally
      expect(mockSetIsSending).toHaveBeenCalledWith(false)
    })

    it("should navigate when sendMessage returns navigateTo", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = "Hello world"
      mockSendMessage.mockResolvedValue({ navigateTo: "/w/ws_123/s/new_stream", replace: true })

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      expect(mockNavigate).toHaveBeenCalledWith("/w/ws_123/s/new_stream", { replace: true })
    })
  })

  describe("attachment display", () => {
    it("should show pending attachments", () => {
      mockComposerState.pendingAttachments = [
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
      mockComposerState.pendingAttachments = [
        {
          id: "temp_123",
          filename: "failed.txt",
          mimeType: "text/plain",
          sizeBytes: 1024,
          status: "error",
          error: "Upload failed",
        },
      ]
      mockComposerState.hasFailed = true

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByText("failed.txt")).toBeInTheDocument()
      expect(screen.getByText("Failed")).toBeInTheDocument()
    })

    it("should disable send button when uploads have failed", () => {
      mockComposerState.hasFailed = true

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      expect(sendButton).toBeDisabled()
    })

    it("should include attachment IDs when sending", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = ""
      mockComposerState.uploadedIds = ["attach_123"]
      mockComposerState.pendingAttachments = [
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

  describe("error handling", () => {
    it("should show error message when sendMessage fails", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = "Hello world"
      mockSendMessage.mockRejectedValue(new Error("Network error"))

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      expect(screen.getByText("Failed to create stream. Please try again.")).toBeInTheDocument()
    })
  })
})
