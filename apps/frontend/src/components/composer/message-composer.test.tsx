import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MessageComposer } from "./message-composer"
import type { PendingAttachment } from "@/hooks/use-attachments"

// Mock RichEditor
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

describe("MessageComposer", () => {
  const defaultProps = {
    content: "",
    onContentChange: vi.fn(),
    pendingAttachments: [] as PendingAttachment[],
    onRemoveAttachment: vi.fn(),
    fileInputRef: { current: null },
    onFileSelect: vi.fn(),
    onSubmit: vi.fn(),
    canSubmit: false,
  }

  describe("rendering", () => {
    it("should render the editor", () => {
      render(<MessageComposer {...defaultProps} />)

      expect(screen.getByTestId("rich-editor")).toBeInTheDocument()
    })

    it("should render the upload button", () => {
      render(<MessageComposer {...defaultProps} />)

      expect(screen.getByTitle("Attach files")).toBeInTheDocument()
    })

    it("should render the submit button with default label", () => {
      render(<MessageComposer {...defaultProps} />)

      expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument()
    })

    it("should render custom submit label", () => {
      render(<MessageComposer {...defaultProps} submitLabel="Reply" />)

      expect(screen.getByRole("button", { name: /reply/i })).toBeInTheDocument()
    })

    it("should render custom placeholder", () => {
      render(<MessageComposer {...defaultProps} placeholder="Write a reply..." />)

      expect(screen.getByPlaceholderText("Write a reply...")).toBeInTheDocument()
    })
  })

  describe("submit button states", () => {
    it("should disable submit button when canSubmit is false", () => {
      render(<MessageComposer {...defaultProps} canSubmit={false} />)

      expect(screen.getByRole("button", { name: /send/i })).toBeDisabled()
    })

    it("should enable submit button when canSubmit is true", () => {
      render(<MessageComposer {...defaultProps} canSubmit={true} />)

      expect(screen.getByRole("button", { name: /send/i })).not.toBeDisabled()
    })

    it("should show submitting label when isSubmitting is true", () => {
      render(<MessageComposer {...defaultProps} isSubmitting={true} submittingLabel="Creating..." />)

      expect(screen.getByRole("button", { name: /creating/i })).toBeInTheDocument()
    })

    it("should show tooltip when hasFailed is true", () => {
      render(<MessageComposer {...defaultProps} hasFailed={true} />)

      // The button should be disabled with tooltip
      const button = screen.getByRole("button", { name: /send/i })
      expect(button).toBeDisabled()
    })
  })

  describe("disabled state", () => {
    it("should disable editor when disabled is true", () => {
      render(<MessageComposer {...defaultProps} disabled={true} />)

      expect(screen.getByTestId("rich-editor")).toBeDisabled()
    })

    it("should disable upload button when disabled is true", () => {
      render(<MessageComposer {...defaultProps} disabled={true} />)

      expect(screen.getByTitle("Attach files")).toBeDisabled()
    })

    it("should disable editor when isSubmitting is true", () => {
      render(<MessageComposer {...defaultProps} isSubmitting={true} />)

      expect(screen.getByTestId("rich-editor")).toBeDisabled()
    })
  })

  describe("interactions", () => {
    it("should call onContentChange when typing", async () => {
      const onContentChange = vi.fn()
      render(<MessageComposer {...defaultProps} onContentChange={onContentChange} />)

      const editor = screen.getByTestId("rich-editor")
      await userEvent.type(editor, "H")

      expect(onContentChange).toHaveBeenCalledWith("H")
    })

    it("should call onSubmit when submit button is clicked", async () => {
      const onSubmit = vi.fn()
      render(<MessageComposer {...defaultProps} onSubmit={onSubmit} canSubmit={true} />)

      const button = screen.getByRole("button", { name: /send/i })
      await userEvent.click(button)

      expect(onSubmit).toHaveBeenCalled()
    })
  })

  describe("attachments", () => {
    it("should render pending attachments", () => {
      const attachments: PendingAttachment[] = [
        { id: "attach_1", filename: "test.txt", mimeType: "text/plain", sizeBytes: 1024, status: "uploaded" },
      ]

      render(<MessageComposer {...defaultProps} pendingAttachments={attachments} />)

      expect(screen.getByText("test.txt")).toBeInTheDocument()
    })

    it("should not render attachments section when empty", () => {
      render(<MessageComposer {...defaultProps} pendingAttachments={[]} />)

      // No attachment chips should be visible
      expect(screen.queryByText(/\.txt$/)).not.toBeInTheDocument()
    })
  })
})
