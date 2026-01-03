import { describe, it, expect, afterEach } from "vitest"
import { Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { EditorBehaviors } from "./editor-behaviors"

/**
 * Helper to create a test editor with the behaviors extension
 */
function createTestEditor(content?: string) {
  const editor = new Editor({
    extensions: [StarterKit, EditorBehaviors],
    content: content ?? "<p></p>",
  })
  return editor
}

/**
 * Helper to get text content from editor
 */
function getTextContent(editor: Editor): string {
  return editor.state.doc.textContent
}

/**
 * Helper to get the current selection range
 */
function getSelection(editor: Editor): { from: number; to: number } {
  const { from, to } = editor.state.selection
  return { from, to }
}

describe("EditorBehaviors", () => {
  let editor: Editor

  afterEach(() => {
    editor?.destroy()
  })

  describe("Tab in code blocks", () => {
    describe("without selection", () => {
      it("should insert tab at cursor position", () => {
        editor = createTestEditor("<pre><code>line1\nline2</code></pre>")
        // Position cursor at start of line2
        editor.commands.setTextSelection(7) // after "line1\n"

        editor.commands.focus()
        // Simulate Tab key
        const handled = editor.view.someProp("handleKeyDown", (f) =>
          f(editor.view, new KeyboardEvent("keydown", { key: "Tab" }))
        )

        expect(handled).toBe(true)
        expect(getTextContent(editor)).toBe("line1\n\tline2")
      })

      it("should dedent line with Shift+Tab when line starts with tab", () => {
        editor = createTestEditor("<pre><code>\tindented line</code></pre>")
        editor.commands.setTextSelection(5) // somewhere in the line

        const handled = editor.view.someProp("handleKeyDown", (f) =>
          f(editor.view, new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }))
        )

        expect(handled).toBe(true)
        expect(getTextContent(editor)).toBe("indented line")
      })

      it("should dedent line with Shift+Tab when line starts with spaces", () => {
        editor = createTestEditor("<pre><code>  indented line</code></pre>")
        editor.commands.setTextSelection(5)

        editor.view.someProp("handleKeyDown", (f) =>
          f(editor.view, new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }))
        )

        expect(getTextContent(editor)).toBe("indented line")
      })

      it("should do nothing with Shift+Tab when line has no indentation", () => {
        editor = createTestEditor("<pre><code>no indent</code></pre>")
        const originalContent = getTextContent(editor)
        editor.commands.setTextSelection(3)

        editor.view.someProp("handleKeyDown", (f) =>
          f(editor.view, new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }))
        )

        expect(getTextContent(editor)).toBe(originalContent)
      })
    })

    describe("with selection", () => {
      it("should indent all selected lines", () => {
        editor = createTestEditor("<pre><code>line1\nline2\nline3</code></pre>")
        // Select from start of line1 to end of line2
        editor.commands.setTextSelection({ from: 1, to: 12 })

        editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: "Tab" })))

        expect(getTextContent(editor)).toBe("\tline1\n\tline2\nline3")
      })

      it("should not indent empty lines", () => {
        editor = createTestEditor("<pre><code>line1\n\nline3</code></pre>")
        // Select all
        editor.commands.setTextSelection({ from: 1, to: 13 })

        editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: "Tab" })))

        expect(getTextContent(editor)).toBe("\tline1\n\n\tline3")
      })

      it("should dedent all selected lines with Shift+Tab", () => {
        editor = createTestEditor("<pre><code>\tline1\n\tline2\nline3</code></pre>")
        // Select indented lines
        editor.commands.setTextSelection({ from: 1, to: 14 })

        editor.view.someProp("handleKeyDown", (f) =>
          f(editor.view, new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }))
        )

        expect(getTextContent(editor)).toBe("line1\nline2\nline3")
      })

      it("should preserve selection after indent (starting from line beginning)", () => {
        editor = createTestEditor("<pre><code>line1\nline2</code></pre>")
        editor.commands.setTextSelection({ from: 1, to: 12 })

        editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: "Tab" })))

        const { from, to } = getSelection(editor)
        // Selection should start from beginning of first line (pos 1)
        expect(from).toBe(1)
        // Selection end should be adjusted for added tabs
        expect(to).toBe(14) // original 12 + 2 tabs
      })

      it("should preserve selection after dedent", () => {
        editor = createTestEditor("<pre><code>\tline1\n\tline2</code></pre>")
        editor.commands.setTextSelection({ from: 1, to: 14 })

        editor.view.someProp("handleKeyDown", (f) =>
          f(editor.view, new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }))
        )

        const { from, to } = getSelection(editor)
        expect(from).toBe(1)
        // Selection end should be adjusted for removed tabs
        expect(to).toBe(12) // original 14 - 2 tabs
      })
    })
  })

  describe("Tab in regular text", () => {
    describe("without selection", () => {
      it("should insert tab at cursor position", () => {
        editor = createTestEditor("<p>hello world</p>")
        editor.commands.setTextSelection(6) // after "hello"

        editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: "Tab" })))

        expect(getTextContent(editor)).toBe("hello\t world")
      })

      it("should dedent paragraph with Shift+Tab", () => {
        editor = createTestEditor("<p>\tindented text</p>")
        editor.commands.setTextSelection(5)

        editor.view.someProp("handleKeyDown", (f) =>
          f(editor.view, new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }))
        )

        expect(getTextContent(editor)).toBe("indented text")
      })
    })

    describe("with selection spanning multiple paragraphs", () => {
      it("should indent all selected paragraphs", () => {
        editor = createTestEditor("<p>para1</p><p>para2</p><p>para3</p>")
        // Select across all paragraphs
        editor.commands.setTextSelection({ from: 1, to: 17 })

        editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: "Tab" })))

        expect(getTextContent(editor)).toBe("\tpara1\tpara2\tpara3")
      })

      it("should dedent all selected paragraphs with Shift+Tab", () => {
        editor = createTestEditor("<p>\tpara1</p><p>\tpara2</p><p>para3</p>")
        // Select first two paragraphs
        editor.commands.setTextSelection({ from: 1, to: 15 })

        editor.view.someProp("handleKeyDown", (f) =>
          f(editor.view, new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }))
        )

        expect(getTextContent(editor)).toBe("para1para2para3")
      })

      it("should preserve selection starting from first block after indent", () => {
        editor = createTestEditor("<p>para1</p><p>para2</p>")
        editor.commands.setTextSelection({ from: 3, to: 10 }) // partial selection

        editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: "Tab" })))

        const { from } = getSelection(editor)
        // Selection should expand to start of first block
        expect(from).toBe(1)
      })
    })

    describe("select all (Cmd+A)", () => {
      it("should work with all content selected", () => {
        editor = createTestEditor("<p>line1</p><p>line2</p><p>line3</p>")
        // Simulate select all
        editor.commands.selectAll()

        editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: "Tab" })))

        expect(getTextContent(editor)).toBe("\tline1\tline2\tline3")
      })
    })
  })

  describe("Cmd/Ctrl+A in code blocks", () => {
    it("should select only code block content when cursor is inside", () => {
      editor = createTestEditor("<pre><code>code here</code></pre>")
      // Position cursor inside code block
      editor.commands.setTextSelection(3)

      // Verify cursor is in code block
      expect(editor.isActive("codeBlock")).toBe(true)

      // Get the code block boundaries
      const { $from } = editor.state.selection
      const codeBlockStart = $from.start($from.depth)
      const codeBlockEnd = $from.end($from.depth)

      // Select the code block content (simulating what Mod-a does)
      editor.commands.setTextSelection({ from: codeBlockStart, to: codeBlockEnd })

      // The selection should cover the code block content
      const { from, to } = getSelection(editor)
      const selectedText = editor.state.doc.textBetween(from, to)
      expect(selectedText).toBe("code here")
    })

    it("should detect when code block is already fully selected", () => {
      editor = createTestEditor("<pre><code>code</code></pre>")
      // Position cursor inside code block
      editor.commands.setTextSelection(2)

      // Get code block boundaries
      const { $from } = editor.state.selection
      const codeBlockStart = $from.start($from.depth)
      const codeBlockEnd = $from.end($from.depth)

      // First: not fully selected
      const selection1 = editor.state.selection
      const alreadySelectingAll1 = selection1.from === codeBlockStart && selection1.to === codeBlockEnd
      expect(alreadySelectingAll1).toBe(false)

      // Select all of code block
      editor.commands.setTextSelection({ from: codeBlockStart, to: codeBlockEnd })

      // Now: fully selected
      const selection2 = editor.state.selection
      const alreadySelectingAll2 = selection2.from === codeBlockStart && selection2.to === codeBlockEnd
      expect(alreadySelectingAll2).toBe(true)
    })

    it("should not be active in code block when cursor is in paragraph", () => {
      editor = createTestEditor("<p>regular paragraph</p>")
      editor.commands.setTextSelection(5)

      // Should not be in a code block
      expect(editor.isActive("codeBlock")).toBe(false)
    })
  })

  describe("Shift+Enter behavior", () => {
    it("should insert newline character in code blocks", () => {
      editor = createTestEditor("<pre><code>line1</code></pre>")
      editor.commands.setTextSelection(6) // at end of "line1"

      editor.view.someProp("handleKeyDown", (f) =>
        f(editor.view, new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }))
      )

      expect(getTextContent(editor)).toBe("line1\n")
    })

    it("should insert hard break in paragraphs", () => {
      editor = createTestEditor("<p>hello world</p>")
      editor.commands.setTextSelection(6) // after "hello"

      editor.view.someProp("handleKeyDown", (f) =>
        f(editor.view, new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }))
      )

      // Hard break is rendered as a separate node, text content stays same
      // but there should now be a hardBreak node
      const hasHardBreak = editor.state.doc.content.content.some((node) =>
        node.content.content.some((child) => child.type.name === "hardBreak")
      )
      expect(hasHardBreak).toBe(true)
    })
  })

  describe("Tab should not change browser focus", () => {
    it("should always return true for Tab to prevent focus change", () => {
      editor = createTestEditor("<p>text</p>")
      editor.commands.setTextSelection(3)

      const handled = editor.view.someProp("handleKeyDown", (f) =>
        f(editor.view, new KeyboardEvent("keydown", { key: "Tab" }))
      )

      expect(handled).toBe(true)
    })

    it("should always return true for Shift+Tab to prevent focus change", () => {
      editor = createTestEditor("<p>text</p>")
      editor.commands.setTextSelection(3)

      const handled = editor.view.someProp("handleKeyDown", (f) =>
        f(editor.view, new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }))
      )

      expect(handled).toBe(true)
    })
  })
})
