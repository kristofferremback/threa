import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Editor } from "@tiptap/react"
import { EditorToolbar } from "./editor-toolbar"
import { indentSelection, dedentSelection, isSuggestionActive } from "./editor-behaviors"

vi.mock("./editor-behaviors", () => ({
  indentSelection: vi.fn(),
  dedentSelection: vi.fn(),
  isSuggestionActive: vi.fn(() => false),
}))

function createEditorStub() {
  const chain = {
    focus: vi.fn(() => chain),
    toggleBold: vi.fn(() => chain),
    toggleItalic: vi.fn(() => chain),
    toggleStrike: vi.fn(() => chain),
    toggleCode: vi.fn(() => chain),
    toggleBlockquote: vi.fn(() => chain),
    toggleBulletList: vi.fn(() => chain),
    toggleOrderedList: vi.fn(() => chain),
    toggleCodeBlock: vi.fn(() => chain),
    toggleHeading: vi.fn(() => chain),
    setParagraph: vi.fn(() => chain),
    run: vi.fn(() => true),
  }

  return {
    isActive: vi.fn(() => false),
    chain: vi.fn(() => chain),
    commands: {
      focus: vi.fn(),
    },
    on: vi.fn(),
    off: vi.fn(),
    __chainState: chain,
    __run: chain.run,
  } as unknown as Editor
}

describe("EditorToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps inline formatting buttons in the tab order", async () => {
    const user = userEvent.setup()
    const editor = createEditorStub() as Editor & {
      __chainState: { focus: ReturnType<typeof vi.fn>; toggleBold: ReturnType<typeof vi.fn> }
      __run: ReturnType<typeof vi.fn>
    }

    render(<EditorToolbar editor={editor} isVisible inline />)

    await user.tab()
    await user.tab()

    expect(screen.getByRole("button", { name: "Bold" })).toHaveFocus()
  })

  it("supports keyboard activation for inline formatting buttons", async () => {
    const user = userEvent.setup()
    const editor = createEditorStub() as Editor & {
      __chainState: { focus: ReturnType<typeof vi.fn>; toggleBold: ReturnType<typeof vi.fn> }
      __run: ReturnType<typeof vi.fn>
    }

    render(<EditorToolbar editor={editor} isVisible inline />)

    await user.tab()
    await user.tab()
    await user.keyboard("{Enter}")

    expect(editor.__chainState.focus).toHaveBeenCalled()
    expect(editor.__chainState.toggleBold).toHaveBeenCalled()
    expect(editor.__run).toHaveBeenCalled()
  })

  it("supports pointer activation for inline formatting buttons", async () => {
    const user = userEvent.setup()
    const editor = createEditorStub() as Editor & {
      __chainState: { focus: ReturnType<typeof vi.fn>; toggleBold: ReturnType<typeof vi.fn> }
      __run: ReturnType<typeof vi.fn>
    }

    render(<EditorToolbar editor={editor} isVisible inline />)

    await user.click(screen.getByRole("button", { name: "Bold" }))

    expect(editor.__chainState.focus).toHaveBeenCalled()
    expect(editor.__chainState.toggleBold).toHaveBeenCalled()
    expect(editor.__run).toHaveBeenCalled()
  })

  it("renders indent and dedent controls only when special input controls are enabled", () => {
    const editor = createEditorStub()
    const { rerender } = render(<EditorToolbar editor={editor} isVisible inline inlinePosition="below" />)

    expect(screen.queryByRole("button", { name: "Indent" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Dedent" })).not.toBeInTheDocument()

    rerender(<EditorToolbar editor={editor} isVisible inline inlinePosition="below" showSpecialInputControls />)

    expect(screen.getByRole("button", { name: "Indent" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Dedent" })).toBeInTheDocument()
  })

  it("dispatches shared indent and dedent commands from the mobile controls", () => {
    const editor = createEditorStub()
    render(<EditorToolbar editor={editor} isVisible inline inlinePosition="below" showSpecialInputControls />)

    fireEvent.pointerDown(screen.getByRole("button", { name: "Indent" }))
    fireEvent.pointerDown(screen.getByRole("button", { name: "Dedent" }))
    expect(indentSelection).not.toHaveBeenCalled()
    expect(dedentSelection).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Indent" }))
    fireEvent.click(screen.getByRole("button", { name: "Dedent" }))

    expect(indentSelection).toHaveBeenCalledWith(editor)
    expect(dedentSelection).toHaveBeenCalledWith(editor)
  })

  it("skips indent and dedent when a suggestion popup is active", () => {
    const editor = createEditorStub()
    vi.mocked(isSuggestionActive).mockReturnValue(true)
    render(<EditorToolbar editor={editor} isVisible inline inlinePosition="below" showSpecialInputControls />)

    fireEvent.click(screen.getByRole("button", { name: "Indent" }))
    fireEvent.click(screen.getByRole("button", { name: "Dedent" }))

    expect(indentSelection).not.toHaveBeenCalled()
    expect(dedentSelection).not.toHaveBeenCalled()
  })

  it("uses a dedicated scroll container for the mobile inline toolbar without the edge fade overlay", () => {
    const editor = createEditorStub()
    const { container } = render(
      <EditorToolbar editor={editor} isVisible inline inlinePosition="below" showSpecialInputControls />
    )

    expect(screen.getByTestId("mobile-inline-toolbar-scroll")).toBeInTheDocument()
    expect(container.querySelector(".bg-gradient-to-l")).toBeNull()
  })

  it("neutralizes ghost hover and uses active:bg-muted for mobile toolbar buttons", () => {
    const editor = createEditorStub()
    render(<EditorToolbar editor={editor} isVisible inline inlinePosition="below" showSpecialInputControls />)

    const boldButton = screen.getByRole("button", { name: "Bold" })
    expect(boldButton.className).toContain("active:bg-muted")
    expect(boldButton.className).toContain("hover:bg-transparent")
    expect(boldButton.className).not.toContain("hover:bg-muted")
  })

  it("preserves toggled-on background through hover for mobile toolbar buttons", () => {
    const editor = createEditorStub()
    vi.mocked(editor.isActive).mockImplementation((type) => type === "bold")
    render(<EditorToolbar editor={editor} isVisible inline inlinePosition="below" showSpecialInputControls />)

    const boldButton = screen.getByRole("button", { name: "Bold" })
    expect(boldButton.className).toContain("bg-muted-foreground/20")
    expect(boldButton.className).toContain("hover:bg-muted-foreground/20")
  })
})
