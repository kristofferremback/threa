import { describe, it, expect } from "vitest"
import { Editor } from "@tiptap/core"
import { createEditorExtensions } from "./editor-extensions"
import { parseMarkdown, serializeToMarkdown } from "./editor-markdown"
import { EditorBehaviors, indentSelection, dedentSelection, handleLinkToolbarAction } from "./editor-behaviors"

function createTestEditor(markdown: string) {
  return new Editor({
    element: document.createElement("div"),
    extensions: createEditorExtensions({ placeholder: "Type a message..." }),
    content: parseMarkdown(
      markdown,
      () => "user",
      () => null
    ),
  })
}

function selectAll(editor: Editor) {
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size })
}

function createBehaviorEditor(markdown: string) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [
      ...createEditorExtensions({ placeholder: "Type a message..." }),
      EditorBehaviors.configure({
        sendModeRef: { current: "enter" },
        onSubmitRef: { current: () => {} },
      }),
    ],
    content: parseMarkdown(
      markdown,
      () => "user",
      () => null
    ),
  })
}

function pressKey(editor: Editor, key: string, options: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  })
  let handled = false

  editor.view.someProp("handleKeyDown", (handleKeyDown) => {
    if (handleKeyDown(editor.view, event)) {
      handled = true
      return true
    }
    return false
  })

  return handled
}

function getCodeBoundaryWidget(editor: Editor) {
  return editor.view.dom.querySelector<HTMLElement>("[data-inline-code-boundary]")
}

function parseCh(value: string) {
  const match = /^(-?\d*\.?\d+)ch$/.exec(value)
  if (!match) {
    throw new Error(`Expected a ch value, got "${value}"`)
  }
  return Number(match[1])
}

describe("editor-behaviors indentation commands", () => {
  it("indents selected text blocks", () => {
    const editor = createTestEditor("line 1\n\nline 2")

    selectAll(editor)
    indentSelection(editor)

    expect(serializeToMarkdown(editor.getJSON())).toBe("\tline 1\n\n\tline 2")
    editor.destroy()
  })

  it("dedents selected code block lines", () => {
    const editor = createTestEditor("```\n\tconst a = 1\n\tconst b = 2\n```")

    selectAll(editor)
    dedentSelection(editor)

    expect(serializeToMarkdown(editor.getJSON())).toBe("```\nconst a = 1\nconst b = 2\n```")
    editor.destroy()
  })

  it("traps Shift+Tab even when a top-level list item cannot be dedented further", () => {
    const editor = createBehaviorEditor("- item")
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })
    let handled = false

    editor.commands.focus("start")
    editor.view.someProp("handleKeyDown", (handleKeyDown) => {
      if (handleKeyDown(editor.view, event)) {
        handled = true
        return true
      }
      return false
    })

    expect(handled).toBe(true)
    editor.destroy()
  })

  it("traps Tab even when a single list item cannot be indented further", () => {
    const editor = createBehaviorEditor("- item")
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    let handled = false

    editor.commands.focus("start")
    editor.view.someProp("handleKeyDown", (handleKeyDown) => {
      if (handleKeyDown(editor.view, event)) {
        handled = true
        return true
      }
      return false
    })

    expect(handled).toBe(true)
    editor.destroy()
  })

  it("exits inline code at the end without inserting whitespace", () => {
    const editor = createBehaviorEditor("`code`")

    editor.commands.focus("end")

    expect(editor.isActive("code")).toBe(true)
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeMode).toBe("inside")
    expect(pressKey(editor, "ArrowRight")).toBe(true)
    expect(editor.isActive("code")).toBe(false)
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeMode).toBe("outside")

    editor.commands.insertContent("x")

    expect(serializeToMarkdown(editor.getJSON())).toBe("`code`x")
    editor.destroy()
  })

  it("re-enters inline code at the end boundary with ArrowLeft", () => {
    const editor = createBehaviorEditor("`code`")

    editor.commands.focus("end")
    pressKey(editor, "ArrowRight")

    expect(editor.isActive("code")).toBe(false)
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeMode).toBe("outside")
    expect(pressKey(editor, "ArrowLeft")).toBe(true)
    expect(editor.isActive("code")).toBe(true)
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeMode).toBe("inside")

    editor.commands.insertContent("x")

    expect(serializeToMarkdown(editor.getJSON())).toBe("`codex`")
    editor.destroy()
  })

  it("renders the inline code boundary widget with zero net layout footprint", () => {
    const editor = createBehaviorEditor("`code`")

    editor.commands.focus("end")

    const widget = getCodeBoundaryWidget(editor)
    expect(widget).toBeTruthy()

    const width = parseCh(widget?.style.width ?? "")
    const marginLeft = parseCh(widget?.style.marginLeft ?? "")
    const marginRight = parseCh(widget?.style.marginRight ?? "")

    expect(width + marginLeft + marginRight).toBeCloseTo(0, 5)
    editor.destroy()
  })

  it("treats link boundaries as outside by default", () => {
    const editor = createBehaviorEditor("[link](https://example.com)")

    editor.commands.focus("end")

    expect(editor.isActive("link")).toBe(false)
    expect(pressKey(editor, "ArrowLeft")).toBe(false)

    editor.commands.insertContent("s")

    expect(serializeToMarkdown(editor.getJSON())).toBe("[link](https://example.com)s")
    editor.destroy()
  })

  it("extends link text when typing inside an existing link", () => {
    const editor = createBehaviorEditor("[lnk](https://example.com)")

    editor.commands.setTextSelection(2)
    editor.commands.insertContent("i")

    expect(serializeToMarkdown(editor.getJSON())).toBe("[link](https://example.com)")
    editor.destroy()
  })

  it("exits link styling from the toolbar without unlinking existing text", () => {
    const editor = createBehaviorEditor("[code](https://example.com)")
    const onOpenChange = () => {
      throw new Error("link popover should not open when exiting link styling")
    }

    editor.commands.setTextSelection(3)

    expect(editor.isActive("link")).toBe(true)
    expect(handleLinkToolbarAction(editor, false, onOpenChange)).toBe("exited")
    expect(editor.isActive("link")).toBe(false)

    editor.commands.insertContent("X")

    expect(serializeToMarkdown(editor.getJSON())).toBe("[co](https://example.com)X[de](https://example.com)")
    editor.destroy()
  })
})
