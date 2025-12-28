import { describe, it, expect, afterEach } from "vitest"
import { Editor, JSONContent } from "@tiptap/react"
import type { EditorView } from "@tiptap/pm/view"
import { createEditorExtensions } from "./editor-extensions"

/**
 * Tests for input rules triggered by simulated typing.
 *
 * These tests verify that input rules fire correctly when the user types
 * the closing marker (e.g., the second * in *italic*).
 *
 * We simulate typing by calling the view's handleTextInput prop directly,
 * which is how ProseMirror plugins receive text input.
 */

// Minimal suggestion config for testing
const testSuggestionConfig = {
  items: () => [],
  render: () => ({
    onStart: () => {},
    onUpdate: () => {},
    onExit: () => {},
    onKeyDown: () => false,
  }),
}

function createTestEditor(content?: string | JSONContent) {
  const extensions = createEditorExtensions({
    placeholder: "Test",
    mentionSuggestion: testSuggestionConfig,
    channelSuggestion: testSuggestionConfig,
    commandSuggestion: testSuggestionConfig,
  })

  const editor = new Editor({
    extensions,
    content: content ?? "<p></p>",
  })
  return editor
}

/**
 * Simulate typing a character at the current cursor position.
 * This triggers input rules just like real typing would.
 */
function simulateTyping(editor: Editor, char: string): boolean {
  const { view, state } = editor
  const { from, to } = state.selection

  // Call handleTextInput on all plugins that have it
  // This is the same path that real typing takes
  let handled = false
  view.someProp("handleTextInput", (f) => {
    // Type assertion needed because someProp types are complex
    const handler = f as (view: EditorView, from: number, to: number, text: string) => boolean | void
    const result = handler(view, from, to, char)
    if (result) handled = true
    return result
  })

  // If no plugin handled it, insert the character normally
  if (!handled) {
    editor.commands.insertContent(char)
  }

  return handled
}

/**
 * Type a string character by character
 */
function typeString(editor: Editor, str: string) {
  for (const char of str) {
    simulateTyping(editor, char)
  }
}

/**
 * Check if a node has a specific mark
 */
function nodeHasMark(node: JSONContent, markName: string): boolean {
  return node.marks?.some((m) => (typeof m === "string" ? m === markName : m.type === markName)) ?? false
}

/**
 * Find all text nodes in the document
 */
function findAllTextNodes(doc: JSONContent): JSONContent[] {
  const results: JSONContent[] = []
  if (doc.type === "text") results.push(doc)
  for (const child of doc.content ?? []) {
    results.push(...findAllTextNodes(child))
  }
  return results
}

/**
 * Find all nodes of a specific type from the document
 */
function findAllNodes(doc: JSONContent, typeName: string): JSONContent[] {
  const results: JSONContent[] = []
  if (doc.type === typeName) results.push(doc)
  for (const child of doc.content ?? []) {
    results.push(...findAllNodes(child, typeName))
  }
  return results
}

describe("Input Rules - Simulated Typing", () => {
  let editor: Editor

  afterEach(() => {
    editor?.destroy()
  })

  describe("Italic with single asterisk", () => {
    it("should apply italic when typing closing *", () => {
      editor = createTestEditor("<p>*hello</p>")

      // Position cursor at end
      editor.commands.focus("end")

      // Type the closing *
      simulateTyping(editor, "*")

      // Check the result
      const json = editor.getJSON()
      const textNodes = findAllTextNodes(json)

      // Should have "hello" with italic mark, no asterisks
      expect(textNodes.length).toBeGreaterThan(0)

      const helloNode = textNodes.find((n) => n.text === "hello")
      if (helloNode) {
        expect(nodeHasMark(helloNode, "italic")).toBe(true)
      } else {
        // If text got combined differently, check for italic anywhere
        const hasItalic = textNodes.some((n) => nodeHasMark(n, "italic"))
        expect(hasItalic).toBe(true)
      }
    })

    it("should apply italic to text with spaces: *hello world*", () => {
      editor = createTestEditor("<p>*hello world</p>")
      editor.commands.focus("end")

      simulateTyping(editor, "*")

      const json = editor.getJSON()
      const textNodes = findAllTextNodes(json)

      const hasItalic = textNodes.some((n) => nodeHasMark(n, "italic"))
      expect(hasItalic).toBe(true)
    })
  })

  describe("Bold with double asterisk", () => {
    it("should apply bold when typing closing **", () => {
      editor = createTestEditor("<p>**hello*</p>")
      editor.commands.focus("end")

      // Type the second closing *
      simulateTyping(editor, "*")

      const json = editor.getJSON()
      const textNodes = findAllTextNodes(json)

      const hasBold = textNodes.some((n) => nodeHasMark(n, "bold"))
      expect(hasBold).toBe(true)
    })

    it("should NOT apply italic prematurely when only one * is closed", () => {
      // Start with **hello
      editor = createTestEditor("<p>**hello</p>")
      editor.commands.focus("end")

      // Type only one * (not enough to close **)
      simulateTyping(editor, "*")

      const json = editor.getJSON()
      const textNodes = findAllTextNodes(json)

      // Should NOT have bold yet (only one * typed)
      const hasBold = textNodes.some((n) => nodeHasMark(n, "bold"))
      // At this point we have **hello* - no complete pattern
      expect(hasBold).toBe(false)
    })
  })

  describe("Inline code with backtick", () => {
    it("should apply code mark when typing closing backtick", () => {
      editor = createTestEditor("<p>`hello</p>")
      editor.commands.focus("end")

      simulateTyping(editor, "`")

      const json = editor.getJSON()
      const textNodes = findAllTextNodes(json)

      const hasCode = textNodes.some((n) => nodeHasMark(n, "code"))
      expect(hasCode).toBe(true)
    })
  })

  describe("Strikethrough with double tilde", () => {
    it("should apply strike when typing closing ~~", () => {
      editor = createTestEditor("<p>~~hello~</p>")
      editor.commands.focus("end")

      simulateTyping(editor, "~")

      const json = editor.getJSON()
      const textNodes = findAllTextNodes(json)

      const hasStrike = textNodes.some((n) => nodeHasMark(n, "strike"))
      expect(hasStrike).toBe(true)
    })
  })

  describe("With mentions (atom nodes)", () => {
    it("should apply bold to mention when typing closing **", () => {
      // Set up: **Hello [mention]
      editor = createTestEditor({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "**Hello " },
              {
                type: "mention",
                attrs: { id: "ariadne", slug: "ariadne", name: "ariadne", mentionType: "user" },
              },
              { type: "text", text: "*" },
            ],
          },
        ],
      })

      editor.commands.focus("end")

      // Type the second closing *
      simulateTyping(editor, "*")

      const json = editor.getJSON()
      const mentions = findAllNodes(json, "mention")

      // The mention should have bold mark
      expect(mentions.length).toBe(1)
      expect(nodeHasMark(mentions[0], "bold")).toBe(true)
    })

    it("should convert mention to text when typing closing backtick for code", () => {
      // Set up: `Hello [mention]
      editor = createTestEditor({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "`Hello " },
              {
                type: "mention",
                attrs: { id: "ariadne", slug: "ariadne", name: "ariadne", mentionType: "user" },
              },
            ],
          },
        ],
      })

      editor.commands.focus("end")

      // Type the closing backtick
      simulateTyping(editor, "`")

      const json = editor.getJSON()

      // The mention should be converted to text
      const mentions = findAllNodes(json, "mention")
      expect(mentions.length).toBe(0)

      // Should have code-marked text containing "@ariadne"
      const textNodes = findAllTextNodes(json)
      const codeNode = textNodes.find((n) => nodeHasMark(n, "code"))
      expect(codeNode).toBeDefined()
      expect(codeNode?.text).toContain("@ariadne")
    })

    it("should convert channel to text when typing closing backtick for code", () => {
      // Set up: `Check [channel]
      editor = createTestEditor({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "`Check " },
              {
                type: "channelLink",
                attrs: { id: "general", slug: "general", name: "general" },
              },
            ],
          },
        ],
      })

      editor.commands.focus("end")

      // Type the closing backtick
      simulateTyping(editor, "`")

      const json = editor.getJSON()

      // The channel should be converted to text
      const channels = findAllNodes(json, "channelLink")
      expect(channels.length).toBe(0)

      // Should have code-marked text containing "#general"
      const textNodes = findAllTextNodes(json)
      const codeNode = textNodes.find((n) => nodeHasMark(n, "code"))
      expect(codeNode).toBeDefined()
      expect(codeNode?.text).toContain("#general")
    })
  })

  describe("Edge cases", () => {
    it("should not apply formatting to whitespace-only content", () => {
      editor = createTestEditor("<p>*   </p>")
      editor.commands.focus("end")

      simulateTyping(editor, "*")

      const json = editor.getJSON()
      const textNodes = findAllTextNodes(json)

      // Should NOT have italic (whitespace-only content)
      const hasItalic = textNodes.some((n) => nodeHasMark(n, "italic"))
      expect(hasItalic).toBe(false)
    })

    it("should handle typing full pattern from scratch", () => {
      editor = createTestEditor("<p></p>")
      editor.commands.focus("end")

      // Type *hello*
      typeString(editor, "*hello*")

      const json = editor.getJSON()
      const textNodes = findAllTextNodes(json)

      const hasItalic = textNodes.some((n) => nodeHasMark(n, "italic"))
      expect(hasItalic).toBe(true)
    })
  })
})
