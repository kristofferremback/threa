import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import type { JSONContent } from "@tiptap/react"
import { createEditorExtensions } from "./editor-extensions"
import { serializeToMarkdown, parseMarkdown } from "./editor-markdown"
import { handleBeforeInputNewline, insertPastedText, toggleMultilineBlock } from "./multiline-blocks"

function createTestEditor(content: string | JSONContent) {
  return new Editor({
    element: document.createElement("div"),
    extensions: createEditorExtensions({ placeholder: "Type a message..." }),
    content:
      typeof content === "string"
        ? parseMarkdown(
            content,
            () => "user",
            () => null
          )
        : content,
  })
}

function createBlockquote(lines: string[]): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "blockquote",
        content: lines.map((line) => ({
          type: "paragraph",
          content: line ? [{ type: "text", text: line }] : undefined,
        })),
      },
    ],
  }
}

function findTextPosition(editor: Editor, text: string, occurrence = 1): number {
  let remaining = occurrence
  let found: number | null = null

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return true
    }

    const index = node.text.indexOf(text)
    if (index === -1) {
      return true
    }

    remaining -= 1
    if (remaining === 0) {
      found = pos + index
      return false
    }

    return true
  })

  if (found === null) {
    throw new Error(`Could not find text: ${text}`)
  }

  return found
}

function setCursor(editor: Editor, text: string, occurrence = 1) {
  const from = findTextPosition(editor, text, occurrence)
  editor.commands.setTextSelection(from)
}

function selectText(editor: Editor, text: string) {
  const from = findTextPosition(editor, text)
  editor.commands.setTextSelection({ from, to: from + text.length })
}

function selectLines(editor: Editor, startText: string, endText: string) {
  const from = findTextPosition(editor, startText)
  const to = findTextPosition(editor, endText) + endText.length
  editor.commands.setTextSelection({ from, to })
}

function createBeforeInputEvent(inputType: "insertParagraph" | "insertLineBreak" = "insertParagraph") {
  return {
    inputType,
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
}

describe("multiline block toggles", () => {
  it("unwraps only the current code block line when toggled off below the first line", () => {
    const editor = createTestEditor("```\nline 1\nline 2\nline 3\n```")

    setCursor(editor, "line 2")
    toggleMultilineBlock(editor, "codeBlock")

    expect(serializeToMarkdown(editor.getJSON())).toBe("```\nline 1\n```\n\nline 2\n\n```\nline 3\n```")
    editor.destroy()
  })

  it("unwraps the full code block when toggled off from the first line", () => {
    const editor = createTestEditor("```\nline 1\nline 2\nline 3\n```")

    setCursor(editor, "line 1")
    toggleMultilineBlock(editor, "codeBlock")

    expect(serializeToMarkdown(editor.getJSON())).toBe("line 1\n\nline 2\n\nline 3")
    editor.destroy()
  })

  it("unwraps the selected code block lines without removing the rest of the block", () => {
    const editor = createTestEditor("```\nline 1\nline 2\nline 3\n```")

    selectLines(editor, "line 2", "line 3")
    toggleMultilineBlock(editor, "codeBlock")

    expect(serializeToMarkdown(editor.getJSON())).toBe("```\nline 1\n```\n\nline 2\n\nline 3")
    editor.destroy()
  })

  it("unwraps only the current blockquote line when toggled off below the first line", () => {
    const editor = createTestEditor(createBlockquote(["line 1", "line 2", "line 3"]))

    setCursor(editor, "line 2")
    toggleMultilineBlock(editor, "blockquote")

    expect(serializeToMarkdown(editor.getJSON())).toBe("> line 1\n\nline 2\n\n> line 3")
    editor.destroy()
  })

  it("unwraps the full blockquote when toggled off from the first line", () => {
    const editor = createTestEditor(createBlockquote(["line 1", "line 2", "line 3"]))

    setCursor(editor, "line 1")
    toggleMultilineBlock(editor, "blockquote")

    expect(serializeToMarkdown(editor.getJSON())).toBe("line 1\n\nline 2\n\nline 3")
    editor.destroy()
  })

  it("unwraps the selected blockquote lines without removing the rest of the quote", () => {
    const editor = createTestEditor(createBlockquote(["line 1", "line 2", "line 3"]))

    selectLines(editor, "line 2", "line 3")
    toggleMultilineBlock(editor, "blockquote")

    expect(serializeToMarkdown(editor.getJSON())).toBe("> line 1\n\nline 2\n\nline 3")
    editor.destroy()
  })
})

describe("multiline block paste handling", () => {
  it("keeps pasted multiline text inside a code block", () => {
    const editor = createTestEditor("```\nseed\n```")

    selectText(editor, "seed")
    insertPastedText(
      editor,
      "line 1\nline 2",
      () => "user",
      () => null
    )

    expect(serializeToMarkdown(editor.getJSON())).toBe("```\nline 1\nline 2\n```")
    editor.destroy()
  })

  it("keeps pasted multiline text inside a blockquote", () => {
    const editor = createTestEditor(createBlockquote(["seed"]))

    selectText(editor, "seed")
    insertPastedText(
      editor,
      "line 1\nline 2",
      () => "user",
      () => null
    )

    expect(serializeToMarkdown(editor.getJSON())).toBe("> line 1\n> line 2")
    editor.destroy()
  })
})

describe("multiline beforeinput enter handling", () => {
  it("exits a code block after a second newline via beforeinput", () => {
    const editor = createTestEditor("```\nconst x = 1\n```")

    editor.commands.setTextSelection(editor.state.doc.content.size - 1)

    const firstEvent = createBeforeInputEvent()
    expect(handleBeforeInputNewline(editor, firstEvent)).toBe(true)
    expect(firstEvent.prevented).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock")
    expect(editor.state.doc.firstChild?.textContent).toBe("const x = 1\n")

    const secondEvent = createBeforeInputEvent()
    expect(handleBeforeInputNewline(editor, secondEvent)).toBe(true)
    expect(secondEvent.prevented).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock")
    expect(editor.state.doc.firstChild?.textContent).toBe("const x = 1")
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph")
    expect(editor.isActive("codeBlock")).toBe(false)
    editor.destroy()
  })

  it("exits a blockquote after a second newline via beforeinput", () => {
    const editor = createTestEditor(createBlockquote(["quoted line"]))

    editor.commands.setTextSelection(editor.state.doc.content.size - 1)

    const firstEvent = createBeforeInputEvent()
    expect(handleBeforeInputNewline(editor, firstEvent)).toBe(true)
    expect(firstEvent.prevented).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe("blockquote")
    expect(editor.state.doc.firstChild?.childCount).toBe(2)

    const secondEvent = createBeforeInputEvent()
    expect(handleBeforeInputNewline(editor, secondEvent)).toBe(true)
    expect(secondEvent.prevented).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe("blockquote")
    expect(editor.state.doc.firstChild?.childCount).toBe(1)
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph")
    expect(editor.isActive("blockquote")).toBe(false)
    editor.destroy()
  })
})
