import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { Editor } from "@tiptap/react"
import { EditorToolbar } from "./editor-toolbar"
import { indentSelection, dedentSelection } from "./editor-behaviors"

vi.mock("./editor-behaviors", () => ({
  indentSelection: vi.fn(),
  dedentSelection: vi.fn(),
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
  } as unknown as Editor
}

describe("EditorToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it("uses a dedicated scroll container for the mobile inline toolbar without the edge fade overlay", () => {
    const editor = createEditorStub()
    const { container } = render(
      <EditorToolbar editor={editor} isVisible inline inlinePosition="below" showSpecialInputControls />
    )

    expect(screen.getByTestId("mobile-inline-toolbar-scroll")).toBeInTheDocument()
    expect(container.querySelector(".bg-gradient-to-l")).toBeNull()
  })

  it("stops touch propagation from the mobile scroll container", () => {
    const editor = createEditorStub()
    render(<EditorToolbar editor={editor} isVisible inline inlinePosition="below" showSpecialInputControls />)

    const scrollContainer = screen.getByTestId("mobile-inline-toolbar-scroll")
    const event = new Event("touchstart", { bubbles: true, cancelable: true })
    const stopPropagation = vi.spyOn(event, "stopPropagation")

    fireEvent(scrollContainer, event)

    expect(stopPropagation).toHaveBeenCalled()
  })
})
