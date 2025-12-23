import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ThreadDraftPanel } from "./index"

// Mock react-router-dom
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}))

// Mock contexts
const mockStreamCreate = vi.fn()
const mockMessageCreate = vi.fn()

vi.mock("@/contexts", () => ({
  useStreamService: () => ({ create: mockStreamCreate }),
  useMessageService: () => ({ create: mockMessageCreate }),
}))

// Mock hooks
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
  useStreamBootstrap: () => ({
    data: {
      events: [
        {
          eventType: "message_created",
          payload: { messageId: "msg_parent", content: "Parent message content" },
        },
      ],
    },
  }),
  getDraftMessageKey: ({ type, parentMessageId }: { type: string; parentMessageId: string }) =>
    `${type}:${parentMessageId}`,
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
        </div>
      ))}
      <button onClick={onSubmit} disabled={!canSubmit || hasFailed}>
        {isSubmitting ? "Creating..." : "Reply"}
      </button>
    </div>
  ),
}))

// Mock EventItem
vi.mock("@/components/timeline", () => ({
  EventItem: ({ event }: { event: { payload: { content: string } } }) => (
    <div data-testid="parent-message">{event.payload.content}</div>
  ),
}))

describe("ThreadDraftPanel", () => {
  const workspaceId = "ws_123"
  const parentStreamId = "stream_456"
  const parentMessageId = "msg_parent"
  const onClose = vi.fn()
  const onThreadCreated = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockStreamCreate.mockResolvedValue({ id: "stream_new_thread" })
    mockMessageCreate.mockResolvedValue({})
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
    it("should render the thread draft panel", () => {
      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      expect(screen.getByText("New thread")).toBeInTheDocument()
      expect(screen.getByTestId("rich-editor")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /reply/i })).toBeInTheDocument()
    })

    it("should show parent message", () => {
      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      expect(screen.getByTestId("parent-message")).toBeInTheDocument()
      expect(screen.getByText("Parent message content")).toBeInTheDocument()
    })
  })

  describe("attachment handling", () => {
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

      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      expect(screen.getByText("test.txt")).toBeInTheDocument()
    })

    it("should enable reply button with only uploaded attachments and no text", () => {
      mockComposerState.canSend = true
      mockComposerState.pendingAttachments = [
        {
          id: "attach_123",
          filename: "test.txt",
          mimeType: "text/plain",
          sizeBytes: 1024,
          status: "uploaded",
        },
      ]

      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      const replyButton = screen.getByRole("button", { name: /reply/i })
      expect(replyButton).not.toBeDisabled()
    })

    it("should disable reply button when uploads have failed", () => {
      mockComposerState.hasFailed = true
      mockComposerState.pendingAttachments = [
        {
          id: "temp_123",
          filename: "failed.txt",
          mimeType: "text/plain",
          sizeBytes: 1024,
          status: "error",
        },
      ]

      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      const replyButton = screen.getByRole("button", { name: /reply/i })
      expect(replyButton).toBeDisabled()
    })
  })

  describe("thread creation", () => {
    it("should create thread and send message when reply is clicked", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = "Hello thread"

      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      const replyButton = screen.getByRole("button", { name: /reply/i })
      await userEvent.click(replyButton)

      expect(mockStreamCreate).toHaveBeenCalledWith(workspaceId, {
        type: "thread",
        parentStreamId,
        parentMessageId,
      })

      expect(mockMessageCreate).toHaveBeenCalledWith(workspaceId, "stream_new_thread", {
        streamId: "stream_new_thread",
        content: "Hello thread",
        contentFormat: "markdown",
        attachmentIds: undefined,
      })

      expect(onThreadCreated).toHaveBeenCalledWith("stream_new_thread")
    })

    it("should clear draft and attachments when thread is created", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = "Hello thread"

      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      const replyButton = screen.getByRole("button", { name: /reply/i })
      await userEvent.click(replyButton)

      expect(mockClearDraft).toHaveBeenCalled()
      expect(mockClearAttachments).toHaveBeenCalled()
    })

    it("should include attachment IDs when creating thread with attachments", async () => {
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

      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      const replyButton = screen.getByRole("button", { name: /reply/i })
      await userEvent.click(replyButton)

      expect(mockMessageCreate).toHaveBeenCalledWith(
        workspaceId,
        "stream_new_thread",
        expect.objectContaining({
          attachmentIds: ["attach_123"],
        })
      )
    })
  })

  describe("close behavior", () => {
    it("should call onClose when X button is clicked", async () => {
      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      // Find the X button (it's the one with just X icon)
      const closeButtons = screen.getAllByRole("button")
      const closeButton = closeButtons.find((btn) => btn.querySelector("svg.lucide-x"))

      expect(closeButton).toBeTruthy()
      await userEvent.click(closeButton!)

      expect(onClose).toHaveBeenCalled()
    })
  })
})
