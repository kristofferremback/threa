import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
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
const mockAddAttachment = vi.fn()
const mockRemoveAttachment = vi.fn()

vi.mock("@/hooks", () => ({
  useStreamOrDraft: () => ({ sendMessage: mockSendMessage }),
  useDraftMessage: () => ({
    content: "",
    attachments: [],
    saveDraftDebounced: mockSaveDraftDebounced,
    addAttachment: mockAddAttachment,
    removeAttachment: mockRemoveAttachment,
    clearDraft: mockClearDraft,
  }),
  getDraftMessageKey: () => "test-draft-key",
}))

// Mock attachments API
const mockUpload = vi.fn()
const mockDelete = vi.fn()
vi.mock("@/api", () => ({
  attachmentsApi: {
    upload: (...args: unknown[]) => mockUpload(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
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
  })

  function createFile(name: string, type: string, size: number = 1024): File {
    const content = new Array(size).fill("a").join("")
    return new File([content], name, { type })
  }

  describe("file upload error handling", () => {
    it("should show error state when upload fails with 4xx error", async () => {
      mockUpload.mockRejectedValue(new Error("File type not allowed"))

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const file = createFile("document.exe", "application/x-msdownload")
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

      await userEvent.upload(fileInput, file)

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByText("Failed")).toBeInTheDocument()
      })

      // Error message should be shown in tooltip (attachment chip shows "Failed")
      expect(screen.getByText("document.exe")).toBeInTheDocument()
    })

    it("should show error state when upload fails with 5xx error", async () => {
      mockUpload.mockRejectedValue(new Error("Internal server error"))

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const file = createFile("report.pdf", "application/pdf")
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

      await userEvent.upload(fileInput, file)

      await waitFor(() => {
        expect(screen.getByText("Failed")).toBeInTheDocument()
      })
    })

    it("should disable send button when there are failed uploads", async () => {
      mockUpload.mockRejectedValue(new Error("Upload failed"))

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      // Type a message first
      const editor = screen.getByTestId("rich-editor")
      await userEvent.type(editor, "Hello world")

      // Upload a file that will fail
      const file = createFile("test.txt", "text/plain")
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      await userEvent.upload(fileInput, file)

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByText("Failed")).toBeInTheDocument()
      })

      // Send button should be disabled
      const sendButton = screen.getByRole("button", { name: /send/i })
      expect(sendButton).toBeDisabled()
    })

    it("should wrap disabled send button in tooltip trigger when uploads failed", async () => {
      mockUpload.mockRejectedValue(new Error("Upload failed"))

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const file = createFile("test.txt", "text/plain")
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      await userEvent.upload(fileInput, file)

      await waitFor(() => {
        expect(screen.getByText("Failed")).toBeInTheDocument()
      })

      // The send button should be disabled and wrapped in a tooltip trigger
      const sendButton = screen.getByRole("button", { name: /send/i })
      expect(sendButton).toBeDisabled()
      // The button's parent span has data-state="closed" indicating it's a tooltip trigger
      expect(sendButton.parentElement).toHaveAttribute("data-state", "closed")
    })

    it("should allow removing failed uploads", async () => {
      mockUpload.mockRejectedValue(new Error("Upload failed"))

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const file = createFile("test.txt", "text/plain")
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      await userEvent.upload(fileInput, file)

      await waitFor(() => {
        expect(screen.getByText("Failed")).toBeInTheDocument()
      })

      // Click remove button
      const removeButton = screen.getByRole("button", { name: /remove test\.txt/i })
      await userEvent.click(removeButton)

      // Failed attachment should be removed
      await waitFor(() => {
        expect(screen.queryByText("Failed")).not.toBeInTheDocument()
      })
    })

    it("should re-enable send button after removing failed uploads", async () => {
      mockUpload.mockRejectedValue(new Error("Upload failed"))

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      // Type a message
      const editor = screen.getByTestId("rich-editor")
      await userEvent.type(editor, "Hello world")

      // Upload a file that will fail
      const file = createFile("test.txt", "text/plain")
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      await userEvent.upload(fileInput, file)

      await waitFor(() => {
        expect(screen.getByText("Failed")).toBeInTheDocument()
      })

      // Send button should be disabled
      expect(screen.getByRole("button", { name: /send/i })).toBeDisabled()

      // Remove the failed upload
      const removeButton = screen.getByRole("button", { name: /remove test\.txt/i })
      await userEvent.click(removeButton)

      // Send button should be enabled again
      await waitFor(() => {
        const sendButton = screen.getByRole("button", { name: /send/i })
        expect(sendButton).not.toBeDisabled()
      })
    })

    it("should handle mixed successful and failed uploads", async () => {
      // First upload succeeds, second fails
      mockUpload
        .mockResolvedValueOnce({
          id: "attach_success",
          filename: "success.txt",
          mimeType: "text/plain",
          sizeBytes: 100,
        })
        .mockRejectedValueOnce(new Error("Upload failed"))

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const successFile = createFile("success.txt", "text/plain", 100)
      const failFile = createFile("fail.txt", "text/plain", 100)
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

      // Upload both files
      await userEvent.upload(fileInput, [successFile, failFile])

      // Wait for both to complete
      await waitFor(() => {
        expect(screen.getByText("success.txt")).toBeInTheDocument()
        expect(screen.getByText("fail.txt")).toBeInTheDocument()
      })

      // One should show as failed
      expect(screen.getByText("Failed")).toBeInTheDocument()

      // Send button should be disabled due to the failed upload
      const sendButton = screen.getByRole("button", { name: /send/i })
      expect(sendButton).toBeDisabled()
    })

    it("should capture specific error messages from 4xx errors", async () => {
      const specificError = "File size exceeds 10MB limit"
      mockUpload.mockRejectedValue(new Error(specificError))

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const file = createFile("large.zip", "application/zip", 15 * 1024 * 1024)
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      await userEvent.upload(fileInput, file)

      await waitFor(() => {
        expect(screen.getByText("Failed")).toBeInTheDocument()
      })

      // The failed attachment chip should be wrapped in a tooltip trigger (for showing the specific error)
      const failedChip = screen.getByText("Failed").closest("[data-state]")
      expect(failedChip).toHaveAttribute("data-state", "closed")
    })
  })

  describe("successful upload flow", () => {
    it("should show uploading state while file is being uploaded", async () => {
      // Create a promise we can control
      let resolveUpload: (value: unknown) => void
      mockUpload.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpload = resolve
          })
      )

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const file = createFile("test.txt", "text/plain")
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      await userEvent.upload(fileInput, file)

      // Should show uploading state (spinner icon via opacity class)
      await waitFor(() => {
        expect(screen.getByText("test.txt")).toBeInTheDocument()
      })

      // Resolve the upload
      resolveUpload!({
        id: "attach_123",
        filename: "test.txt",
        mimeType: "text/plain",
        sizeBytes: 1024,
      })

      // Should show file size after upload completes
      await waitFor(() => {
        expect(screen.getByText("1.0 KB")).toBeInTheDocument()
      })
    })

    it("should enable send button with successfully uploaded file", async () => {
      mockUpload.mockResolvedValue({
        id: "attach_123",
        filename: "test.txt",
        mimeType: "text/plain",
        sizeBytes: 1024,
      })

      render(<MessageInput workspaceId={workspaceId} streamId={streamId} />)

      const file = createFile("test.txt", "text/plain")
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      await userEvent.upload(fileInput, file)

      await waitFor(() => {
        expect(screen.getByText("1.0 KB")).toBeInTheDocument()
      })

      // Send button should be enabled
      const sendButton = screen.getByRole("button", { name: /send/i })
      expect(sendButton).not.toBeDisabled()
    })
  })
})
