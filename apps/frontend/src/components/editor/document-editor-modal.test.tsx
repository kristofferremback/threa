import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DocumentEditorModal } from "./document-editor-modal"

const mockPreferences = {
  keyboardShortcuts: {} as Record<string, string>,
}

// Mock react-router-dom
vi.mock("react-router-dom", () => ({
  useParams: () => ({ workspaceId: "ws_123" }),
}))

// Mock hooks used by the editor
vi.mock("@/hooks/use-mentionables", () => ({
  useMentionables: () => ({ mentionables: [] }),
}))

vi.mock("@/hooks/use-workspace-emoji", () => ({
  useWorkspaceEmoji: () => ({
    emojis: [],
    emojiWeights: new Map(),
    toEmoji: () => null,
  }),
}))

// Mock preferences context
vi.mock("@/contexts", () => ({
  usePreferences: () => ({
    preferences: mockPreferences,
    isLoading: false,
  }),
}))

// Mock trigger hooks used by the editor
vi.mock("./triggers", () => ({
  useMentionSuggestion: () => ({
    suggestionConfig: null,
    renderMentionList: () => null,
  }),
  useChannelSuggestion: () => ({
    suggestionConfig: null,
    renderChannelList: () => null,
  }),
  useEmojiSuggestion: () => ({
    suggestionConfig: null,
    renderEmojiGrid: () => null,
  }),
}))

describe("DocumentEditorModal", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSend: vi.fn(),
    streamName: "Test Stream",
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPreferences.keyboardShortcuts = {}
  })

  describe("rendering", () => {
    it("should render the modal when open", () => {
      render(<DocumentEditorModal {...defaultProps} />)

      expect(screen.getByText("Test Stream")).toBeInTheDocument()
      expect(screen.getByText(/Message in/)).toBeInTheDocument()
    })

    it("should not render when closed", () => {
      render(<DocumentEditorModal {...defaultProps} open={false} />)

      expect(screen.queryByText("Test Stream")).not.toBeInTheDocument()
    })

    it("should render the toolbar with formatting buttons", () => {
      render(<DocumentEditorModal {...defaultProps} />)

      // Check for toolbar buttons by aria-label
      expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Italic" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Strikethrough" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Inline code" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Link" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Quote" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Bullet list" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Numbered list" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Code block" })).toBeInTheDocument()
    })

    it("should render heading buttons", () => {
      render(<DocumentEditorModal {...defaultProps} />)

      expect(screen.getByRole("button", { name: "Heading 1" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Heading 2" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Heading 3" })).toBeInTheDocument()
    })

    it("should render Send and Cancel buttons", () => {
      render(<DocumentEditorModal {...defaultProps} />)

      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
    })

    it("should show keyboard hint for sending", () => {
      render(<DocumentEditorModal {...defaultProps} />)

      expect(screen.getByText(/to send/)).toBeInTheDocument()
    })

    it("should omit formatting hints that are disabled by a conflicting global shortcut", async () => {
      const user = userEvent.setup()
      mockPreferences.keyboardShortcuts = { toggleSidebar: "mod+b" }

      render(<DocumentEditorModal {...defaultProps} />)

      await user.hover(screen.getByRole("button", { name: "Bold" }))

      expect((await screen.findAllByText("Bold")).length).toBeGreaterThan(0)
      expect(screen.queryByText(/^Ctrl\+B$|^⌘B$/)).not.toBeInTheDocument()
    })
  })

  describe("interactions", () => {
    it("should call onOpenChange when Cancel is clicked", async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()

      render(<DocumentEditorModal {...defaultProps} onOpenChange={onOpenChange} />)

      await user.click(screen.getByRole("button", { name: "Cancel" }))

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it("should disable Send button when content is empty", () => {
      render(<DocumentEditorModal {...defaultProps} initialContent="" />)

      const sendButton = screen.getByRole("button", { name: "Send" })
      expect(sendButton).toBeDisabled()
    })

    it("should not reset editor content when initialContent prop changes while modal is already open", () => {
      const { rerender } = render(<DocumentEditorModal {...defaultProps} initialContent="Hello World" />)

      // Editor initialised with content — Send is enabled
      expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled()

      // Parent updates initialContent to empty while the modal stays open
      rerender(<DocumentEditorModal {...defaultProps} initialContent="" />)

      // Send must still be enabled: the editor was not reset to the new (empty) initialContent
      expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled()
    })
  })
})
