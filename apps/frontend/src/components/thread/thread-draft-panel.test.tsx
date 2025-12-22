import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ThreadDraftPanel } from "./thread-draft-panel"

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
const mockSaveDraftDebounced = vi.fn()
const mockClearDraft = vi.fn()
const mockAddDraftAttachment = vi.fn()
const mockRemoveDraftAttachment = vi.fn()

// Control draft loading state for tests
let mockDraftIsLoaded = true
let mockDraftContent = ""
let mockDraftAttachments: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }> = []

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
  useDraftMessage: () => ({
    isLoaded: mockDraftIsLoaded,
    content: mockDraftContent,
    attachments: mockDraftAttachments,
    saveDraftDebounced: mockSaveDraftDebounced,
    addAttachment: mockAddDraftAttachment,
    removeAttachment: mockRemoveDraftAttachment,
    clearDraft: mockClearDraft,
  }),
  getDraftMessageKey: ({ type, parentMessageId }: { type: string; parentMessageId: string }) =>
    `${type}:${parentMessageId}`,
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
    mockDraftIsLoaded = true
    mockDraftContent = ""
    mockDraftAttachments = []
    mockPendingAttachments = []
    mockStreamCreate.mockResolvedValue({ id: "stream_new_thread" })
    mockMessageCreate.mockResolvedValue({})
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

  describe("draft persistence", () => {
    it("should save content changes to draft", async () => {
      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      const editor = screen.getByTestId("rich-editor")
      await userEvent.type(editor, "Hello thread")

      expect(mockSaveDraftDebounced).toHaveBeenCalledWith("Hello thread")
    })

    it("should restore attachments from saved draft on mount", () => {
      mockDraftAttachments = [{ id: "attach_1", filename: "saved.txt", mimeType: "text/plain", sizeBytes: 100 }]

      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      expect(mockRestoreAttachments).toHaveBeenCalledWith(mockDraftAttachments)
    })

    it("should not restore draft while still loading", () => {
      mockDraftIsLoaded = false
      mockDraftContent = "Should not appear"
      mockDraftAttachments = [{ id: "attach_1", filename: "saved.txt", mimeType: "text/plain", sizeBytes: 100 }]

      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      // Should not restore while loading
      expect(mockRestoreAttachments).not.toHaveBeenCalled()
    })
  })

  describe("attachment handling", () => {
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
      mockPendingAttachments = [
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
      mockPendingAttachments = [
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
      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      const editor = screen.getByTestId("rich-editor")
      await userEvent.type(editor, "Hello thread")

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
      render(
        <ThreadDraftPanel
          workspaceId={workspaceId}
          parentStreamId={parentStreamId}
          parentMessageId={parentMessageId}
          onClose={onClose}
          onThreadCreated={onThreadCreated}
        />
      )

      const editor = screen.getByTestId("rich-editor")
      await userEvent.type(editor, "Hello thread")

      const replyButton = screen.getByRole("button", { name: /reply/i })
      await userEvent.click(replyButton)

      expect(mockClearDraft).toHaveBeenCalled()
      expect(mockClearAttachments).toHaveBeenCalled()
    })

    it("should include attachment IDs when creating thread with attachments", async () => {
      mockPendingAttachments = [
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
