import { describe, it, expect } from "vitest"
import { Editor } from "@tiptap/core"
import { createEditorExtensions } from "./editor-extensions"
import { parseMarkdown, serializeToMarkdown } from "./editor-markdown"
import { indentSelection, dedentSelection } from "./editor-behaviors"

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
})
