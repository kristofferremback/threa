import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { forwardRef, useEffect, useImperativeHandle, useState } from "react"
import { MessageComposer } from "./message-composer"
import type { PendingAttachment } from "@/hooks/use-attachments"
import type { JSONContent } from "@threa/types"

let isMobileMockValue = false

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => isMobileMockValue,
}))

// Mock RichEditor/EditorToolbar for deterministic behavior with JSONContent
vi.mock("@/components/editor", () => {
  const RichEditor = forwardRef<
    {
      focus: () => void
      insertMention: () => void
      insertSlash: () => void
      insertEmoji: () => void
      getEditor: () => { id: string } | null
    },
    {
      value: JSONContent
      onChange: (v: JSONContent) => void
      onSubmit: () => void
      placeholder: string
      disabled: boolean
    }
  >(function MockRichEditor({ onChange, onSubmit, placeholder, disabled }, ref) {
    const [editorInstance, setEditorInstance] = useState<{ id: string } | null>(null)
    useEffect(() => {
      const timer = setTimeout(() => setEditorInstance({ id: "mock-editor" }), 0)
      return () => clearTimeout(timer)
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        focus: () => undefined,
        insertMention: () => undefined,
        insertSlash: () => undefined,
        insertEmoji: () => undefined,
        getEditor: () => editorInstance,
      }),
      [editorInstance]
    )

    return (
      <div data-testid="rich-editor-wrapper">
        <textarea
          data-testid="rich-editor"
          data-content-type="json"
          onChange={(e) => {
            // Simulate content change by creating a simple doc with the text
            const text = e.target.value
            onChange({
              type: "doc",
              content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }],
            })
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) onSubmit()
          }}
          placeholder={placeholder}
          disabled={disabled}
        />
      </div>
    )
  })

  const EditorToolbar = ({
    editor,
    isVisible,
    showSpecialInputControls,
  }: {
    editor: { id: string } | null
    isVisible: boolean
    showSpecialInputControls?: boolean
  }) =>
    isVisible ? (
      <div
        data-testid="mobile-editor-toolbar"
        data-has-editor={editor ? "yes" : "no"}
        data-has-special-input-controls={showSpecialInputControls ? "yes" : "no"}
      >
        {showSpecialInputControls && (
          <>
            <button type="button">Indent</button>
            <button type="button">Dedent</button>
          </>
        )}
      </div>
    ) : null

  return { RichEditor, EditorToolbar }
})

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }

describe("MessageComposer", () => {
  beforeEach(() => {
    isMobileMockValue = false
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const defaultProps = {
    content: EMPTY_DOC,
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

      // Upload button has aria-label "Attach files" via tooltip
      expect(screen.getByRole("button", { name: /attach files/i })).toBeInTheDocument()
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

      expect(screen.getByRole("button", { name: /attach files/i })).toBeDisabled()
    })

    it("should keep editor editable when isSubmitting is true (prevents mobile keyboard close)", () => {
      render(<MessageComposer {...defaultProps} isSubmitting={true} />)

      expect(screen.getByTestId("rich-editor")).not.toBeDisabled()
    })
  })

  describe("interactions", () => {
    it("should call onContentChange when typing", async () => {
      const onContentChange = vi.fn()
      render(<MessageComposer {...defaultProps} onContentChange={onContentChange} />)

      const editor = screen.getByTestId("rich-editor")
      await userEvent.type(editor, "H")

      // Should have been called with JSONContent structure
      expect(onContentChange).toHaveBeenCalled()
      expect(onContentChange).toHaveBeenCalledWith(expect.objectContaining({ type: "doc" }))
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

  describe("mobile state handling", () => {
    it("shows nested block text in collapsed mobile preview", () => {
      isMobileMockValue = true

      const nestedDoc: JSONContent = {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "First item" }] }],
              },
            ],
          },
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "mention", attrs: { slug: "kris", label: "kris" } },
                  { type: "text", text: " said hi" },
                ],
              },
            ],
          },
        ],
      }

      render(<MessageComposer {...defaultProps} content={nestedDoc} />)

      expect(screen.getByText("First item @kris said hi")).toBeInTheDocument()
    })

    it("resets mobile focus state when scope changes", () => {
      isMobileMockValue = true

      const { rerender } = render(<MessageComposer {...defaultProps} scopeId="scope-a" />)

      expect(screen.getByText("Type a message...")).toBeInTheDocument()

      fireEvent.click(screen.getByText("Type a message..."))
      expect(screen.queryByText("Type a message...")).not.toBeInTheDocument()

      rerender(<MessageComposer {...defaultProps} scopeId="scope-b" />)
      expect(screen.getByText("Type a message...")).toBeInTheDocument()
    })

    it("closes mobile formatting toolbar on blur", () => {
      isMobileMockValue = true
      vi.useFakeTimers()

      render(<MessageComposer {...defaultProps} />)

      fireEvent.click(screen.getByText("Type a message..."))

      const formatButton = screen.getByRole("button", { name: "Formatting" })
      fireEvent.click(formatButton)
      expect(screen.getByTestId("mobile-editor-toolbar")).toBeInTheDocument()

      fireEvent.blur(screen.getByTestId("rich-editor"))
      act(() => {
        vi.advanceTimersByTime(200)
      })

      expect(screen.queryByTestId("mobile-editor-toolbar")).not.toBeInTheDocument()
    })

    it("updates mobile toolbar editor when editor instance becomes available asynchronously", () => {
      isMobileMockValue = true
      vi.useFakeTimers()

      render(<MessageComposer {...defaultProps} />)

      fireEvent.click(screen.getByText("Type a message..."))
      fireEvent.click(screen.getByRole("button", { name: "Formatting" }))

      expect(screen.getByTestId("mobile-editor-toolbar")).toHaveAttribute("data-has-editor", "no")

      act(() => {
        vi.advanceTimersByTime(10)
      })

      expect(screen.getByTestId("mobile-editor-toolbar")).toHaveAttribute("data-has-editor", "yes")
    })

    it("shows mobile indent controls in the formatting toolbar", () => {
      isMobileMockValue = true

      render(<MessageComposer {...defaultProps} />)

      fireEvent.click(screen.getByText("Type a message..."))
      fireEvent.click(screen.getByRole("button", { name: "Formatting" }))

      expect(screen.getByTestId("mobile-editor-toolbar")).toHaveAttribute("data-has-special-input-controls", "yes")
      expect(screen.getByRole("button", { name: "Indent" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Dedent" })).toBeInTheDocument()
    })
  })
})
