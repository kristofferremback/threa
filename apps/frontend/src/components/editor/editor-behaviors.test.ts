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

function pressArrowKey(editor: Editor, direction: "left" | "right") {
  const handled = pressKey(editor, direction === "right" ? "ArrowRight" : "ArrowLeft")

  if (handled) {
    return true
  }

  const { from, empty } = editor.state.selection
  if (!empty) {
    return false
  }

  const target = direction === "right" ? Math.min(from + 1, editor.state.doc.content.size) : Math.max(from - 1, 1)

  if (target !== from) {
    editor.commands.setTextSelection(target)
  }

  return false
}

function getCodeBoundaryWidget(editor: Editor) {
  return editor.view.dom.querySelector<HTMLElement>("[data-inline-code-boundary]")
}

function getCodeBoundaryCaret(editor: Editor) {
  return editor.view.dom.querySelector<HTMLElement>(".inline-code-boundary-caret")
}

function insertCaret(text: string, offset: number) {
  return `${text.slice(0, offset)}|${text.slice(offset)}`
}

function getInlineCodeNavigationSnapshot(editor: Editor) {
  const segments: Array<{
    end: number
    isCode: boolean
    start: number
    text: string
  }> = []

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return
    }

    segments.push({
      text: node.text,
      start: pos,
      end: pos + node.text.length,
      isCode: node.marks.some((mark) => mark.type.name === "code"),
    })
  })

  const codeSegments = segments.filter((segment) => segment.isCode)
  if (codeSegments.length !== 1) {
    throw new Error(`Expected exactly one inline code segment, got ${codeSegments.length}`)
  }

  const codeSegment = codeSegments[0]
  const beforeSegments = segments.filter((segment) => segment.end <= codeSegment.start)
  const afterSegments = segments.filter((segment) => segment.start >= codeSegment.end)
  const beforeText = beforeSegments.map((segment) => segment.text).join("")
  const codeText = codeSegment.text
  const afterText = afterSegments.map((segment) => segment.text).join("")
  const cursorPos = editor.state.selection.from
  const insideCode = (editor.state.storedMarks ?? editor.state.selection.$from.marks()).some(
    (mark) => mark.type.name === "code"
  )

  const plainOffsetForSegments = (
    targetSegments: Array<{
      end: number
      start: number
      text: string
    }>,
    pos: number
  ) => {
    let offset = 0

    for (const segment of targetSegments) {
      if (pos < segment.start) {
        return offset
      }

      if (pos <= segment.end) {
        return offset + (pos - segment.start)
      }

      offset += segment.text.length
    }

    return offset
  }

  if (cursorPos < codeSegment.start || (cursorPos === codeSegment.start && !insideCode)) {
    return insertCaret(`${beforeText}[${codeText}]${afterText}`, plainOffsetForSegments(beforeSegments, cursorPos))
  }

  if (cursorPos > codeSegment.end || (cursorPos === codeSegment.end && !insideCode)) {
    return insertCaret(
      `${beforeText}[${codeText}]${afterText}`,
      beforeText.length + codeText.length + 2 + plainOffsetForSegments(afterSegments, cursorPos)
    )
  }

  return `${beforeText}[${insertCaret(codeText, cursorPos - codeSegment.start)}]${afterText}`
}

const inlineCodeNavigationStates = [
  "|a [code] b",
  "a| [code] b",
  "a |[code] b",
  "a [|code] b",
  "a [c|ode] b",
  "a [co|de] b",
  "a [cod|e] b",
  "a [code|] b",
  "a [code]| b",
  "a [code] |b",
  "a [code] b|",
] as const

function moveInlineCodeCaret(editor: Editor, direction: "left" | "right", steps = 1) {
  for (let step = 0; step < steps; step += 1) {
    pressArrowKey(editor, direction)
  }
}

function createInlineCodeNavigationEditor() {
  return createBehaviorEditor("a `code` b")
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
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeBoundary).toBe("end")
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeMode).toBe("inside")
    expect(editor.view.dom.style.caretColor).toBe("transparent")
    expect(pressKey(editor, "ArrowRight")).toBe(true)
    expect(editor.isActive("code")).toBe(false)
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeBoundary).toBe("end")
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeMode).toBe("outside")
    expect(editor.view.dom.style.caretColor).toBe("transparent")

    editor.commands.insertContent("x")

    expect(serializeToMarkdown(editor.getJSON())).toBe("`code`x")
    editor.destroy()
  })

  it("re-enters inline code at the end boundary with ArrowLeft", () => {
    const editor = createBehaviorEditor("`code`")

    editor.commands.focus("end")
    pressKey(editor, "ArrowRight")

    expect(editor.isActive("code")).toBe(false)
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeBoundary).toBe("end")
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeMode).toBe("outside")
    expect(pressKey(editor, "ArrowLeft")).toBe(true)
    expect(editor.isActive("code")).toBe(true)
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeBoundary).toBe("end")
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeMode).toBe("inside")
    expect(editor.view.dom.style.caretColor).toBe("transparent")

    editor.commands.insertContent("x")

    expect(serializeToMarkdown(editor.getJSON())).toBe("`codex`")
    editor.destroy()
  })

  it("renders the inline code boundary overlay without changing layout width", () => {
    const editor = createBehaviorEditor("`code`")

    editor.commands.focus("end")

    const widget = getCodeBoundaryWidget(editor)
    const caret = getCodeBoundaryCaret(editor)
    expect(widget).toBeTruthy()
    expect(caret).toBeTruthy()

    expect(widget?.textContent).toBe("")
    expect(widget?.style.fontSize).toBe("inherit")
    expect(widget?.style.height).toBe("1em")
    expect(widget?.style.width).toBe("0px")
    expect(widget?.style.overflow).toBe("visible")
    expect(caret?.style.width).toBe("0px")
    expect(caret?.style.transform).toBe("")
    editor.destroy()
  })

  it("shows the synthetic caret on both start-edge boundary modes", () => {
    const editor = createBehaviorEditor("`code`")

    editor.commands.focus("start")

    expect(editor.isActive("code")).toBe(true)
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeBoundary).toBe("start")
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeMode).toBe("inside")
    expect(editor.view.dom.style.caretColor).toBe("transparent")
    expect(pressKey(editor, "ArrowLeft")).toBe(true)
    expect(editor.isActive("code")).toBe(false)
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeBoundary).toBe("start")
    expect(getCodeBoundaryWidget(editor)?.dataset.inlineCodeMode).toBe("outside")
    expect(editor.view.dom.style.caretColor).toBe("transparent")

    editor.destroy()
  })

  it("walks every caret location from left to right through inline code with surrounding text", () => {
    const editor = createInlineCodeNavigationEditor()

    editor.commands.focus("start")

    expect(getInlineCodeNavigationSnapshot(editor)).toBe(inlineCodeNavigationStates[0])

    for (let index = 1; index < inlineCodeNavigationStates.length; index += 1) {
      pressArrowKey(editor, "right")
      expect(getInlineCodeNavigationSnapshot(editor)).toBe(inlineCodeNavigationStates[index])
    }

    editor.destroy()
  })

  it("walks every caret location from right to left through inline code with surrounding text", () => {
    const editor = createInlineCodeNavigationEditor()

    editor.commands.focus("end")

    expect(getInlineCodeNavigationSnapshot(editor)).toBe(
      inlineCodeNavigationStates[inlineCodeNavigationStates.length - 1]
    )

    for (let index = inlineCodeNavigationStates.length - 2; index >= 0; index -= 1) {
      pressArrowKey(editor, "left")
      expect(getInlineCodeNavigationSnapshot(editor)).toBe(inlineCodeNavigationStates[index])
    }

    editor.destroy()
  })

  it("moves one logical step left and right from every caret location around inline code", () => {
    for (let index = 0; index < inlineCodeNavigationStates.length; index += 1) {
      const editor = createInlineCodeNavigationEditor()

      editor.commands.focus("start")
      moveInlineCodeCaret(editor, "right", index)

      expect(getInlineCodeNavigationSnapshot(editor)).toBe(inlineCodeNavigationStates[index])

      if (index > 0) {
        pressArrowKey(editor, "left")
        expect(getInlineCodeNavigationSnapshot(editor)).toBe(inlineCodeNavigationStates[index - 1])
        pressArrowKey(editor, "right")
        expect(getInlineCodeNavigationSnapshot(editor)).toBe(inlineCodeNavigationStates[index])
      }

      if (index < inlineCodeNavigationStates.length - 1) {
        pressArrowKey(editor, "right")
        expect(getInlineCodeNavigationSnapshot(editor)).toBe(inlineCodeNavigationStates[index + 1])
      }

      editor.destroy()
    }
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
