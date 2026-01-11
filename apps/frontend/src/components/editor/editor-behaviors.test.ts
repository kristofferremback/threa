import { describe, it, expect, afterEach, vi } from "vitest"
import { Editor } from "@tiptap/react"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import HardBreak from "@tiptap/extension-hard-break"
import History from "@tiptap/extension-history"
import { EditorBehaviors } from "./editor-behaviors"
import type { MessageSendMode } from "@threa/types"

/**
 * Helper to create a test editor with the behaviors extension
 */
function createTestEditor(content?: string, sendMode: MessageSendMode = "enter", onSubmit = () => {}) {
  const sendModeRef = { current: sendMode }
  const onSubmitRef = { current: onSubmit }
  const editor = new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      History,
      EditorBehaviors.configure({
        sendModeRef,
        onSubmitRef,
      }),
    ],
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

describe("EditorBehaviors", () => {
  let editor: Editor

  afterEach(() => {
    editor?.destroy()
  })

  describe("Tab behavior", () => {
    it("should insert tab character at cursor", () => {
      editor = createTestEditor("<p>hello world</p>")
      editor.commands.setTextSelection(6) // after "hello"

      const handled = editor.view.someProp("handleKeyDown", (f) =>
        f(editor.view, new KeyboardEvent("keydown", { key: "Tab" }))
      )

      expect(handled).toBe(true)
      expect(getTextContent(editor)).toBe("hello\t world")
    })

    it("should prevent browser focus change on Shift+Tab", () => {
      editor = createTestEditor("<p>hello</p>")

      const handled = editor.view.someProp("handleKeyDown", (f) =>
        f(editor.view, new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }))
      )

      expect(handled).toBe(true)
      // Content should be unchanged
      expect(getTextContent(editor)).toBe("hello")
    })
  })

  describe("Enter behavior in 'enter' mode", () => {
    it("should call onSubmit when Enter is pressed", () => {
      const onSubmit = vi.fn()
      editor = createTestEditor("<p>hello</p>", "enter", onSubmit)

      editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: "Enter" })))

      expect(onSubmit).toHaveBeenCalled()
    })

    it("should insert hard break when Shift+Enter is pressed", () => {
      editor = createTestEditor("<p>hello world</p>", "enter")
      editor.commands.setTextSelection(6) // after "hello"

      editor.view.someProp("handleKeyDown", (f) =>
        f(editor.view, new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }))
      )

      // Should have a hard break node
      const hasHardBreak = editor.state.doc.content.content.some((node) =>
        node.content.content.some((child) => child.type.name === "hardBreak")
      )
      expect(hasHardBreak).toBe(true)
    })
  })

  describe("Enter behavior in 'cmdEnter' mode", () => {
    it("should insert hard break when Enter is pressed", () => {
      editor = createTestEditor("<p>hello world</p>", "cmdEnter")
      editor.commands.setTextSelection(6) // after "hello"

      editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key: "Enter" })))

      // Should have a hard break node
      const hasHardBreak = editor.state.doc.content.content.some((node) =>
        node.content.content.some((child) => child.type.name === "hardBreak")
      )
      expect(hasHardBreak).toBe(true)
    })

    it("should call onSubmit when Mod+Enter is pressed", () => {
      const onSubmit = vi.fn()
      editor = createTestEditor("<p>hello</p>", "cmdEnter", onSubmit)

      // TipTap's "Mod" maps to Ctrl in non-Mac test environments
      editor.view.someProp("handleKeyDown", (f) =>
        f(editor.view, new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }))
      )

      expect(onSubmit).toHaveBeenCalled()
    })
  })

  describe("Mod+Enter always sends", () => {
    it("should call onSubmit in 'enter' mode", () => {
      const onSubmit = vi.fn()
      editor = createTestEditor("<p>hello</p>", "enter", onSubmit)

      // TipTap's "Mod" maps to Ctrl in non-Mac test environments
      editor.view.someProp("handleKeyDown", (f) =>
        f(editor.view, new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }))
      )

      expect(onSubmit).toHaveBeenCalled()
    })

    it("should call onSubmit in 'cmdEnter' mode", () => {
      const onSubmit = vi.fn()
      editor = createTestEditor("<p>hello</p>", "cmdEnter", onSubmit)

      // TipTap's "Mod" maps to Ctrl in non-Mac test environments
      editor.view.someProp("handleKeyDown", (f) =>
        f(editor.view, new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }))
      )

      expect(onSubmit).toHaveBeenCalled()
    })
  })
})
