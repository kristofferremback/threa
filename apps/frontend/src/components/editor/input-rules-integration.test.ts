import { describe, it, expect, afterEach } from "vitest"
import { Editor, JSONContent } from "@tiptap/react"
import { createEditorExtensions } from "./editor-extensions"
import { parseMarkdown } from "./editor-markdown"

/**
 * Integration tests for editor behavior with atom nodes (mentions, channels).
 *
 * These tests verify:
 * 1. Markdown parsing applies marks to mentions (paste scenario)
 * 2. Mentions inherit marks when inserted inside styled blocks
 * 3. The atom-aware input rules handle mentions correctly
 *
 * Note: We can't easily test input rules via programmatic typing because
 * TipTap's input rules fire via ProseMirror's handleTextInput, not insertContent.
 * For that, we'd need Playwright/Cypress E2E tests.
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
 * Check if a node has a specific mark
 */
function nodeHasMark(node: JSONContent, markName: string): boolean {
  return node.marks?.some((m) => (typeof m === "string" ? m === markName : m.type === markName)) ?? false
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

describe("Editor Markdown Parsing (Paste Scenario)", () => {
  /**
   * These tests verify parseMarkdown applies marks to atom nodes.
   * This was the bug: pasting "**Hello @ariadne**" didn't make @ariadne bold.
   */

  describe("Mentions with bold formatting", () => {
    it("should apply bold mark to mention in **Hello @mention**", () => {
      const parsed = parseMarkdown("**Hello @ariadne**")

      const mentions = findAllNodes(parsed, "mention")
      expect(mentions.length).toBe(1)

      const mention = mentions[0]
      expect(mention.attrs?.slug).toBe("ariadne")
      expect(nodeHasMark(mention, "bold")).toBe(true)
    })

    it("should apply bold mark to text and mention in **@mention says hi**", () => {
      const parsed = parseMarkdown("**@ariadne says hi**")

      // Check mention has bold
      const mentions = findAllNodes(parsed, "mention")
      expect(mentions.length).toBe(1)
      expect(nodeHasMark(mentions[0], "bold")).toBe(true)

      // Check text has bold
      const textNodes = findAllNodes(parsed, "text")
      const saysNode = textNodes.find((n) => n.text?.includes("says hi"))
      expect(saysNode).toBeDefined()
      expect(nodeHasMark(saysNode!, "bold")).toBe(true)
    })

    it("should apply bold to multiple mentions: **@a and @b**", () => {
      const parsed = parseMarkdown("**@alice and @bob**")

      const mentions = findAllNodes(parsed, "mention")
      expect(mentions.length).toBe(2)

      expect(mentions[0].attrs?.slug).toBe("alice")
      expect(nodeHasMark(mentions[0], "bold")).toBe(true)

      expect(mentions[1].attrs?.slug).toBe("bob")
      expect(nodeHasMark(mentions[1], "bold")).toBe(true)
    })
  })

  describe("Mentions with italic formatting", () => {
    it("should apply italic mark to mention in *Hello @mention*", () => {
      const parsed = parseMarkdown("*Hello @ariadne*")

      const mentions = findAllNodes(parsed, "mention")
      expect(mentions.length).toBe(1)
      expect(nodeHasMark(mentions[0], "italic")).toBe(true)
    })
  })

  describe("Mentions with strikethrough formatting", () => {
    it("should apply strike mark to mention in ~~Hello @mention~~", () => {
      const parsed = parseMarkdown("~~Hello @ariadne~~")

      const mentions = findAllNodes(parsed, "mention")
      expect(mentions.length).toBe(1)
      expect(nodeHasMark(mentions[0], "strike")).toBe(true)
    })
  })

  describe("Channels with formatting", () => {
    it("should apply bold mark to channel in **Check #general**", () => {
      const parsed = parseMarkdown("**Check #general**")

      const channels = findAllNodes(parsed, "channelLink")
      expect(channels.length).toBe(1)
      expect(channels[0].attrs?.slug).toBe("general")
      expect(nodeHasMark(channels[0], "bold")).toBe(true)
    })

    it("should apply italic mark to channel in *See #engineering*", () => {
      const parsed = parseMarkdown("*See #engineering*")

      const channels = findAllNodes(parsed, "channelLink")
      expect(channels.length).toBe(1)
      expect(nodeHasMark(channels[0], "italic")).toBe(true)
    })
  })

  describe("Mixed formatting", () => {
    it("should handle mention in link: [Hello @mention](url)", () => {
      const parsed = parseMarkdown("[Hello @ariadne](https://example.com)")

      const mentions = findAllNodes(parsed, "mention")
      expect(mentions.length).toBe(1)
      expect(nodeHasMark(mentions[0], "link")).toBe(true)
    })

    it("should handle nested bold and italic: ***Hello @mention***", () => {
      const parsed = parseMarkdown("***Hello @ariadne***")

      const mentions = findAllNodes(parsed, "mention")
      expect(mentions.length).toBe(1)

      // Should have both bold and italic marks
      expect(nodeHasMark(mentions[0], "bold")).toBe(true)
      expect(nodeHasMark(mentions[0], "italic")).toBe(true)
    })
  })
})

describe("Editor Mention Insertion with Mark Inheritance", () => {
  let editor: Editor

  afterEach(() => {
    editor?.destroy()
  })

  describe("Inserting mention preserves active marks", () => {
    it("should inherit bold mark when mention inserted via JSON content", () => {
      // This simulates what happens when a mention is inserted with marks
      // (the fix in create-trigger-extension.ts)
      editor = createTestEditor()

      // Insert content with a mention that has a bold mark
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello ", marks: [{ type: "bold" }] },
              {
                type: "mention",
                attrs: { id: "ariadne", slug: "ariadne", name: "ariadne", mentionType: "user" },
                marks: [{ type: "bold" }],
              },
              { type: "text", text: " friend", marks: [{ type: "bold" }] },
            ],
          },
        ],
      })

      const json = editor.getJSON()
      const mentions = findAllNodes(json, "mention")

      expect(mentions.length).toBe(1)
      expect(nodeHasMark(mentions[0], "bold")).toBe(true)
    })

    it("should preserve italic mark on mention", () => {
      editor = createTestEditor()

      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello ", marks: [{ type: "italic" }] },
              {
                type: "mention",
                attrs: { id: "ariadne", slug: "ariadne", name: "ariadne", mentionType: "user" },
                marks: [{ type: "italic" }],
              },
            ],
          },
        ],
      })

      const json = editor.getJSON()
      const mentions = findAllNodes(json, "mention")

      expect(mentions.length).toBe(1)
      expect(nodeHasMark(mentions[0], "italic")).toBe(true)
    })

    it("should preserve multiple marks on mention", () => {
      editor = createTestEditor()

      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: { id: "ariadne", slug: "ariadne", name: "ariadne", mentionType: "user" },
                marks: [{ type: "bold" }, { type: "italic" }],
              },
            ],
          },
        ],
      })

      const json = editor.getJSON()
      const mentions = findAllNodes(json, "mention")

      expect(mentions.length).toBe(1)
      expect(nodeHasMark(mentions[0], "bold")).toBe(true)
      expect(nodeHasMark(mentions[0], "italic")).toBe(true)
    })
  })

  describe("Channel links with marks", () => {
    it("should preserve bold mark on channelLink", () => {
      editor = createTestEditor()

      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Check ", marks: [{ type: "bold" }] },
              {
                type: "channelLink",
                attrs: { id: "general", slug: "general", name: "general" },
                marks: [{ type: "bold" }],
              },
            ],
          },
        ],
      })

      const json = editor.getJSON()
      const channels = findAllNodes(json, "channelLink")

      expect(channels.length).toBe(1)
      expect(nodeHasMark(channels[0], "bold")).toBe(true)
    })
  })
})

describe("Markdown Round-trip with Styled Mentions", () => {
  let editor: Editor

  afterEach(() => {
    editor?.destroy()
  })

  it("should preserve styled mentions through paste → serialize cycle", () => {
    // Parse markdown with styled mention
    const parsed = parseMarkdown("**Hello @ariadne**")

    // Load into editor
    editor = createTestEditor(parsed)

    // Get the document back
    const json = editor.getJSON()

    // Verify mention still has bold
    const mentions = findAllNodes(json, "mention")
    expect(mentions.length).toBe(1)
    expect(mentions[0].attrs?.slug).toBe("ariadne")
    expect(nodeHasMark(mentions[0], "bold")).toBe(true)
  })

  it("should preserve mixed formatting through round-trip", () => {
    const parsed = parseMarkdown("*@alice* and **@bob**")

    editor = createTestEditor(parsed)
    const json = editor.getJSON()

    const mentions = findAllNodes(json, "mention")
    expect(mentions.length).toBe(2)

    const alice = mentions.find((m) => m.attrs?.slug === "alice")
    const bob = mentions.find((m) => m.attrs?.slug === "bob")

    expect(alice).toBeDefined()
    expect(nodeHasMark(alice!, "italic")).toBe(true)

    expect(bob).toBeDefined()
    expect(nodeHasMark(bob!, "bold")).toBe(true)
  })
})
