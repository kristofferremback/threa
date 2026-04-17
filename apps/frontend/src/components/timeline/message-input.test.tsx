import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MessageInput, materializePendingAttachmentReferences } from "./message-input"
import type { JSONContent } from "@threa/types"

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }
const makeDoc = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }],
})
const makeAttachmentDoc = (): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "attachmentReference",
          attrs: {
            id: "attach_1",
            filename: "pasted-image-1.png",
            mimeType: "image/png",
            sizeBytes: 1234,
            status: "uploaded",
            imageIndex: 1,
            error: null,
          },
        },
        { type: "text", text: " Check out this image:" },
      ],
    },
  ],
})

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}))

// Mock preferences context
// Note: messageSendMode affects keyboard behavior (Enter vs Cmd+Enter to send),
// which is tested in E2E tests (message-send-mode.spec.ts). These unit tests
// use button clicks, so the mode doesn't affect the behavior tested here.
let mockMessageSendMode: "enter" | "cmdEnter" = "enter"
vi.mock("@/contexts", () => ({
  usePreferences: () => ({
    preferences: { messageSendMode: mockMessageSendMode },
  }),
  useSocketStatus: () => "connected",
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
const mockComposerFocus = vi.fn()
const mockComposerFocusAfterQuoteReply = vi.fn()
let mockSubmitContentOverride: JSONContent | undefined
let registeredQuoteReplyHandler:
  | ((data: {
      messageId: string
      streamId: string
      authorName: string
      authorId: string
      actorType: string
      snippet: string
    }) => void)
  | null = null

// Composer state that tests can modify
let mockComposerState = {
  content: EMPTY_DOC as JSONContent,
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

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStreams: () => [],
}))

vi.mock("./quote-reply-context", () => ({
  useQuoteReply: () => ({
    triggerQuoteReply: vi.fn(),
    registerHandler: (
      handler: (data: {
        messageId: string
        streamId: string
        authorName: string
        authorId: string
        actorType: string
        snippet: string
      }) => void
    ) => {
      registeredQuoteReplyHandler = handler
      return () => {
        if (registeredQuoteReplyHandler === handler) {
          registeredQuoteReplyHandler = null
        }
      }
    },
  }),
}))

vi.mock("@/hooks", () => ({
  useStreamOrDraft: () => ({ sendMessage: mockSendMessage }),
  getDraftMessageKey: () => "test-draft-key",
  useDraftComposer: () => ({
    content: mockComposerState.content,
    setContent: mockSetContent,
    handleContentChange: mockHandleContentChange,
    pendingAttachments: mockComposerState.pendingAttachments,
    getPendingAttachmentsSnapshot: () => mockComposerState.pendingAttachments,
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
  useComposerHeightPublish: () => {},
}))

// Mock MessageComposer
vi.mock("@/components/composer", () => ({
  MessageComposer: ({
    onSubmit,
    canSubmit,
    isSubmitting,
    hasFailed,
    pendingAttachments,
    composerRef,
  }: {
    content: JSONContent
    onContentChange: (v: JSONContent) => void
    onSubmit: (content?: JSONContent) => void
    canSubmit: boolean
    isSubmitting: boolean
    hasFailed: boolean
    pendingAttachments: Array<{ id: string; filename: string; sizeBytes: number; status: string }>
    composerRef?: { current: { focus: () => void; focusAfterQuoteReply: () => void } | null }
  }) =>
    (() => {
      if (composerRef) {
        composerRef.current = {
          focus: mockComposerFocus,
          focusAfterQuoteReply: mockComposerFocusAfterQuoteReply,
        }
      }

      return (
        <div data-testid="message-composer">
          <textarea data-testid="rich-editor" />
          {pendingAttachments.map((a) => (
            <div key={a.id}>
              <span>{a.filename}</span>
              <span>{a.sizeBytes >= 1024 ? `${(a.sizeBytes / 1024).toFixed(1)} KB` : `${a.sizeBytes} B`}</span>
              {a.status === "error" && <span>Failed</span>}
            </div>
          ))}
          <button onClick={() => onSubmit(mockSubmitContentOverride)} disabled={!canSubmit || hasFailed}>
            {isSubmitting ? "Sending..." : "Send"}
          </button>
        </div>
      )
    })(),
}))

describe("MessageInput", () => {
  const workspaceId = "ws_123"
  const streamId = "stream_456"

  beforeEach(() => {
    vi.clearAllMocks()
    mockSendMessage.mockResolvedValue({})
    mockMessageSendMode = "enter"
    mockComposerState = {
      content: EMPTY_DOC,
      pendingAttachments: [],
      uploadedIds: [],
      isUploading: false,
      hasFailed: false,
      canSend: false,
      isSending: false,
      isLoaded: true,
    }
    mockSubmitContentOverride = undefined
    registeredQuoteReplyHandler = null
    mockComposerFocus.mockReset()
    mockComposerFocusAfterQuoteReply.mockReset()
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

    it("should not throw when toggling between disabled and enabled states", () => {
      const { rerender } = render(
        <MessageInput workspaceId={workspaceId} streamId={streamId} disabled disabledReason="Read-only stream" />
      )

      expect(screen.getByText("Read-only stream")).toBeInTheDocument()

      rerender(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      expect(screen.getByTestId("message-composer")).toBeInTheDocument()
    })
  })

  describe("sending messages", () => {
    it("should call sendMessage when send button is clicked", async () => {
      const helloContent = makeDoc("Hello world")
      mockComposerState.canSend = true
      mockComposerState.content = helloContent

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      expect(mockSendMessage).toHaveBeenCalledWith({
        contentJson: helloContent,
        attachmentIds: undefined,
        attachments: undefined,
      })
    })

    it("should clear draft and attachments after sending", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = makeDoc("Hello world")

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      expect(mockClearDraft).toHaveBeenCalled()
      expect(mockClearAttachments).toHaveBeenCalled()
    })

    it("should prefer the live editor content passed by the composer at submit time", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = makeDoc("stale")
      mockSubmitContentOverride = makeAttachmentDoc()

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      await userEvent.click(screen.getByRole("button", { name: /send/i }))

      expect(mockSendMessage).toHaveBeenCalledWith({
        contentJson: makeAttachmentDoc(),
        attachmentIds: ["attach_1"],
        attachments: [
          {
            id: "attach_1",
            filename: "pasted-image-1.png",
            mimeType: "image/png",
            sizeBytes: 1234,
          },
        ],
      })
    })

    it("should clear the composer immediately before send resolves", async () => {
      let resolveSend: ((value: unknown) => void) | undefined
      mockComposerState.canSend = true
      mockComposerState.content = makeDoc("Hello world")
      mockSendMessage.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSend = resolve
          })
      )

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      expect(mockSetContent).toHaveBeenCalledWith(EMPTY_DOC)
      expect(mockClearDraft).not.toHaveBeenCalled()

      resolveSend?.({})
    })

    it("should set isSending state during send", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = makeDoc("Hello world")

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
      mockComposerState.content = makeDoc("Hello world")
      mockSendMessage.mockResolvedValue({ navigateTo: "/w/ws_123/s/new_stream", replace: true })

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      expect(mockNavigate).toHaveBeenCalledWith("/w/ws_123/s/new_stream", { replace: true })
    })
  })

  describe("quote replies", () => {
    it("inserts a quote block without appending a synthetic trailing paragraph", () => {
      mockComposerState.content = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Before" }] }, { type: "paragraph" }],
      }

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      expect(registeredQuoteReplyHandler).not.toBeNull()

      registeredQuoteReplyHandler?.({
        messageId: "msg_123",
        streamId: "stream_456",
        authorName: "Ariadne",
        authorId: "user_123",
        actorType: "user",
        snippet: "The vibes are immaculate",
      })

      expect(mockSetContent).toHaveBeenCalledWith({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Before" }] },
          {
            type: "quoteReply",
            attrs: {
              messageId: "msg_123",
              streamId: "stream_456",
              authorName: "Ariadne",
              authorId: "user_123",
              actorType: "user",
              snippet: "The vibes are immaculate",
            },
          },
        ],
      })
      expect(mockComposerFocusAfterQuoteReply).toHaveBeenCalledTimes(1)
      expect(mockComposerFocus).not.toHaveBeenCalled()
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
      mockComposerState.content = EMPTY_DOC
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
        contentJson: {
          type: "doc",
          content: [
            { type: "paragraph" },
            {
              type: "paragraph",
              content: [
                {
                  type: "attachmentReference",
                  attrs: {
                    id: "attach_123",
                    filename: "test.txt",
                    mimeType: "text/plain",
                    sizeBytes: 1024,
                    status: "uploaded",
                    imageIndex: null,
                    error: null,
                  },
                },
              ],
            },
          ],
        },
        attachmentIds: ["attach_123"],
        attachments: [{ id: "attach_123", filename: "test.txt", mimeType: "text/plain", sizeBytes: 1024 }],
      })
    })

    it("should materialize uploaded attachment references before sending", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Check this " },
              {
                type: "attachmentReference",
                attrs: {
                  id: "temp_123",
                  filename: "pasted-image-1.png",
                  mimeType: "image/png",
                  sizeBytes: 68,
                  status: "uploading",
                  imageIndex: null,
                  error: null,
                },
              },
            ],
          },
        ],
      }
      mockComposerState.uploadedIds = ["attach_123"]
      mockComposerState.pendingAttachments = [
        {
          id: "attach_123",
          filename: "pasted-image-1.png",
          mimeType: "image/png",
          sizeBytes: 68,
          status: "uploaded",
        },
      ]

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      await userEvent.click(screen.getByRole("button", { name: /send/i }))

      expect(mockSendMessage).toHaveBeenCalledWith({
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Check this " },
                {
                  type: "attachmentReference",
                  attrs: {
                    id: "attach_123",
                    filename: "pasted-image-1.png",
                    mimeType: "image/png",
                    sizeBytes: 68,
                    status: "uploaded",
                    imageIndex: 1,
                    error: null,
                  },
                },
              ],
            },
          ],
        },
        attachmentIds: ["attach_123"],
        attachments: [{ id: "attach_123", filename: "pasted-image-1.png", mimeType: "image/png", sizeBytes: 68 }],
      })
    })
  })

  describe("attachment reference materialization", () => {
    it("should keep existing numbered image references stable", () => {
      const content: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "attachmentReference",
                attrs: {
                  id: "attach_123",
                  filename: "pasted-image-1.png",
                  mimeType: "image/png",
                  sizeBytes: 68,
                  status: "uploaded",
                  imageIndex: 3,
                  error: null,
                },
              },
            ],
          },
        ],
      }

      expect(
        materializePendingAttachmentReferences(content, [
          {
            id: "attach_123",
            filename: "pasted-image-1.png",
            mimeType: "image/png",
            sizeBytes: 68,
            status: "uploaded",
          },
        ])
      ).toEqual(content)
    })

    it("should append uploaded attachments that are missing from the editor document", () => {
      expect(
        materializePendingAttachmentReferences(EMPTY_DOC, [
          {
            id: "attach_123",
            filename: "pasted-image-1.png",
            mimeType: "image/png",
            sizeBytes: 68,
            status: "uploaded",
          },
        ])
      ).toEqual({
        type: "doc",
        content: [
          { type: "paragraph" },
          {
            type: "paragraph",
            content: [
              {
                type: "attachmentReference",
                attrs: {
                  id: "attach_123",
                  filename: "pasted-image-1.png",
                  mimeType: "image/png",
                  sizeBytes: 68,
                  status: "uploaded",
                  imageIndex: 1,
                  error: null,
                },
              },
            ],
          },
        ],
      })
    })
  })

  describe("error handling", () => {
    it("should show error message when sendMessage fails", async () => {
      mockComposerState.canSend = true
      mockComposerState.content = makeDoc("Hello world")
      mockSendMessage.mockRejectedValue(new Error("Network error"))

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const sendButton = screen.getByRole("button", { name: /send/i })
      await userEvent.click(sendButton)

      expect(screen.getByText("Failed to create stream. Please try again.")).toBeInTheDocument()
    })
  })
})
