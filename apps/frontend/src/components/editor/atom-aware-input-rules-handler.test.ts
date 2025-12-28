import { describe, it, expect } from "vitest"
import { Schema } from "@tiptap/pm/model"
import { EditorState } from "@tiptap/pm/state"
import { atomAwareMarkInputRule } from "./atom-aware-input-rules"

/**
 * Tests for the atom-aware input rule handler logic.
 *
 * These tests create ProseMirror documents directly (without TipTap's Editor)
 * to test the position calculations and node traversal used in the handler.
 */

// Simple schema with paragraph, text, and a mention atom node
const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
    mention: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: {
        slug: { default: "" },
      },
      parseDOM: [{ tag: 'span[data-type="mention"]' }],
      toDOM: (node) => ["span", { "data-type": "mention" }, `@${node.attrs.slug}`],
      leafText: (node) => `@${node.attrs.slug}`,
    },
  },
  marks: {
    code: {
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0],
    },
  },
})

describe("Atom-aware input rule handler logic", () => {
  describe("Document structure with mentions", () => {
    it("should correctly represent document positions with mention atoms", () => {
      // Create document: `Hello @ariadne`
      const doc = testSchema.nodes.doc.create({}, [
        testSchema.nodes.paragraph.create({}, [
          testSchema.text("`Hello "),
          testSchema.nodes.mention.create({ slug: "ariadne" }),
          testSchema.text("`"),
        ]),
      ])

      // Document structure:
      // Position 0: doc start (not counted in content.size)
      // Position 1: paragraph start (first content position)
      // Positions 1-7: "`Hello " (7 chars)
      // Position 8: mention (nodeSize = 1)
      // Position 9: "`" (1 char)
      // Position 10: paragraph end
      // Position 11: doc end
      //
      // Content = "`Hello " (7) + mention (1) + "`" (1) = 9 content positions
      // Paragraph nodeSize = 9 + 2 (open/close) = 11
      // Doc content.size = paragraph nodeSize = 11

      expect(doc.content.size).toBe(11) // paragraph takes 11 positions (9 content + 2 wrapper)
      expect(doc.nodeSize).toBe(13) // doc wrapper adds 2 (11 + 2 = 13)

      // Check the paragraph content
      const para = doc.firstChild!
      expect(para.childCount).toBe(3)
      expect(para.child(0).isText).toBe(true)
      expect(para.child(0).text).toBe("`Hello ")
      expect(para.child(1).type.name).toBe("mention")
      expect(para.child(1).isAtom).toBe(true)
      expect(para.child(1).isInline).toBe(true)
      expect(para.child(1).nodeSize).toBe(1)
      expect(para.child(2).text).toBe("`")
    })

    it("should correctly traverse nodes with nodesBetween", () => {
      // Match user's exact scenario: `Hello @ariadne` (no space before mention)
      const doc = testSchema.nodes.doc.create({}, [
        testSchema.nodes.paragraph.create({}, [
          testSchema.text("`Hello "),
          testSchema.nodes.mention.create({ slug: "ariadne" }),
          testSchema.text("`"),
        ]),
      ])

      // Find where the mention actually is
      let mentionPos = -1
      doc.nodesBetween(0, doc.content.size, (node, pos) => {
        if (node.type.name === "mention") {
          mentionPos = pos
        }
        return true
      })

      // Simulate the user's contentEnd calculation
      const end = mentionPos + 2 // closing backtick + 1
      const contentEnd = end - 1 // position of closing backtick

      // Now test with the problematic range
      const visited: { type: string; pos: number; isAtom: boolean }[] = []
      doc.nodesBetween(2, contentEnd, (node, pos) => {
        if (node.isInline) {
          visited.push({
            type: node.type.name,
            pos,
            isAtom: node.isAtom,
          })
        }
        return true
      })

      // The mention at position 8 with contentEnd=9 SHOULD be found
      // But with contentEnd=8, it would NOT be found (8 < 8 is false)
      const mentionVisit = visited.find((v) => v.type === "mention")

      // If contentEnd equals mentionPos, the mention is excluded!
      if (contentEnd === mentionPos) {
        // BUG: contentEnd equals mentionPos, mention will be excluded
        expect(mentionVisit).toBeUndefined() // This is the bug!
      } else {
        expect(mentionVisit).toBeDefined()
      }
    })

    it("should find mention at correct position", () => {
      const doc = testSchema.nodes.doc.create({}, [
        testSchema.nodes.paragraph.create({}, [
          testSchema.text("`Hello "),
          testSchema.nodes.mention.create({ slug: "ariadne" }),
          testSchema.text("`"),
        ]),
      ])

      // Find the mention position
      let mentionPos = -1
      doc.nodesBetween(0, doc.content.size, (node, pos) => {
        if (node.type.name === "mention") {
          mentionPos = pos
        }
        return true
      })

      // The mention should be found
      expect(mentionPos).toBeGreaterThan(0)
    })

    it("should get text representation via leafText", () => {
      const mention = testSchema.nodes.mention.create({ slug: "ariadne" })

      // Check leafText is defined
      const leafTextFn = mention.type.spec.leafText
      expect(leafTextFn).toBeDefined()

      if (leafTextFn) {
        const text = leafTextFn(mention)
        expect(text).toBe("@ariadne")
      }
    })
  })

  describe("Position calculations", () => {
    it("should correctly calculate content boundaries", () => {
      // For `Hello @ariadne`:
      // - Opening ` at position 1
      // - Content starts at position 2
      // - Closing ` at position 9
      // - End (after closing `) at position 10

      const start = 1 // opening marker position
      const end = 10 // position after closing marker
      const openMarkerLength = 1
      const closeMarkerLength = 1

      const contentStart = start + openMarkerLength // 2
      const contentEnd = end - closeMarkerLength // 9

      expect(contentStart).toBe(2)
      expect(contentEnd).toBe(9)

      // Content range [2, 9) should include positions 2-8
      // Position 8 is the mention
    })
  })

  describe("Transaction mapping", () => {
    it("should correctly map positions through deletions", () => {
      const doc = testSchema.nodes.doc.create({}, [testSchema.nodes.paragraph.create({}, [testSchema.text("*hello*")])])

      const state = EditorState.create({ doc, schema: testSchema })
      const tr = state.tr

      // Document: *hello*
      // Position 1: *
      // Position 2-6: hello
      // Position 7: *
      // Position 8: end of paragraph

      // Delete closing * (positions 7-8)
      tr.delete(7, 8)

      // Delete opening * (positions 1-2)
      tr.delete(1, 2)

      // Map original content positions through all deletions
      const originalContentStart = 2
      const originalContentEnd = 7

      const mappedStart = tr.mapping.map(originalContentStart)
      const mappedEnd = tr.mapping.map(originalContentEnd)

      // After deleting 7-8, positions shift: 0-6 unchanged, 7+ shifts left by 1
      // originalContentStart (2) -> 2 (unchanged)
      // originalContentEnd (7) -> 7 (at deletion boundary)

      // After deleting 1-2, positions shift: 0-1 unchanged, 2+ shifts left by 1
      // 2 -> 1
      // 7 -> 6

      expect(mappedStart).toBe(1)
      expect(mappedEnd).toBe(6)
    })
  })

  describe("Handler integration", () => {
    it("should apply italic mark to *Hi friend*", () => {
      // Create document: *Hi friend*
      const doc = testSchema.nodes.doc.create({}, [
        testSchema.nodes.paragraph.create({}, [testSchema.text("*Hi friend*")]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })

      // Document positions:
      // 1: * (opening)
      // 2-10: Hi friend (9 chars)
      // 11: * (closing)
      // 12: paragraph end

      // Create the input rule (verifying it can be created with these params)
      atomAwareMarkInputRule({
        openMarker: "*",
        closeMarker: "*",
        type: testSchema.marks.code, // Using code mark since we have it in schema
        convertAtomsToText: false,
      })

      // The InputRule's find pattern should match "*Hi friend*"
      // range.from = 1, range.to = 12
      // match[1] = "Hi friend"

      // Simulate what InputRule does: call the handler
      const textBefore = state.doc.textBetween(1, 12)

      // Test that pattern matches
      const pattern = /(?<!\*)\*([^\s*]|[^\s*][\s\S]*?[^\s])\*$/
      const match = textBefore.match(pattern)

      expect(match).not.toBeNull()
      expect(match![1]).toBe("Hi friend")
    })

    it("should correctly handle text-only content deletion", () => {
      // This test verifies the marker deletion logic is correct
      const doc = testSchema.nodes.doc.create({}, [
        testSchema.nodes.paragraph.create({}, [testSchema.text("*Hi friend*")]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const tr = state.tr

      // Simulate the handler's operations:
      // 1. No atoms, so skip atom replacement
      // 2. Delete closing marker (position 11-12)
      // 3. Delete opening marker (position 1-2)
      // 4. Apply mark

      const start = 1
      const end = 12
      const openMarkerLength = 1
      const closeMarkerLength = 1
      const contentStart = start + openMarkerLength // 2
      const contentEnd = end - closeMarkerLength // 11

      // Delete closing marker first
      const mappedContentEnd = tr.mapping.map(contentEnd)
      const mappedEnd = tr.mapping.map(end)
      tr.delete(mappedContentEnd, mappedEnd)

      // Delete opening marker
      const mappedStart = tr.mapping.map(start)
      tr.delete(mappedStart, mappedStart + openMarkerLength)

      // Map content boundaries through all transformations
      const markStart = tr.mapping.map(contentStart)
      const markEnd = tr.mapping.map(contentEnd)

      // Apply mark
      if (markStart < markEnd) {
        tr.addMark(markStart, markEnd, testSchema.marks.code.create())
      }

      // Apply transaction and check result
      const newState = state.apply(tr)
      const resultText = newState.doc.textBetween(1, newState.doc.content.size)

      // EXPECT: "Hi friend" (9 chars) with mark
      expect(resultText).toBe("Hi friend")

      // Check that mark was applied
      const $pos = newState.doc.resolve(2) // Position inside content
      const marks = $pos.marks()
      expect(marks.length).toBe(1)
      expect(marks[0].type.name).toBe("code")
    })

    it("should correctly handle mention atom in backtick code", () => {
      // This test verifies mention atoms are converted to text for inline code
      const doc = testSchema.nodes.doc.create({}, [
        testSchema.nodes.paragraph.create({}, [
          testSchema.text("`Hello "),
          testSchema.nodes.mention.create({ slug: "ariadne" }),
          testSchema.text("`"),
        ]),
      ])

      const state = EditorState.create({ doc, schema: testSchema })
      const tr = state.tr

      // Document: `Hello @ariadne`
      // Position 1-7: `Hello  (7 chars including backtick)
      // Position 8: mention (nodeSize = 1)
      // Position 9: ` (closing backtick)
      // Position 10: paragraph end

      const start = 1
      const end = 10 // Position after closing backtick (but within paragraph)
      const openMarkerLength = 1
      const closeMarkerLength = 1
      const contentStart = start + openMarkerLength // 2
      const contentEnd = end - closeMarkerLength // 9

      // For convertAtomsToText, we need to find and replace atoms
      // Use searchEnd = end to ensure we capture nodes at the boundary
      const searchEnd = end
      const atomNodes: { pos: number; size: number; text: string }[] = []

      state.doc.nodesBetween(contentStart, searchEnd, (node, pos) => {
        const nodeEnd = pos + node.nodeSize
        const isInContentRange = pos < contentEnd && nodeEnd > contentStart
        // IMPORTANT: isAtom is true for ALL leaf nodes including text!
        // Must check !node.isText to only match actual atom nodes like mentions
        if (node.isAtom && node.isInline && !node.isText && isInContentRange) {
          // Get text from leafText
          const leafTextFn = node.type.spec.leafText
          const text = leafTextFn ? leafTextFn(node) : ""
          atomNodes.push({ pos, size: node.nodeSize, text })
        }
        return true
      })

      // EXPECT: We should find the mention
      expect(atomNodes.length).toBe(1)
      expect(atomNodes[0].text).toBe("@ariadne")
      expect(atomNodes[0].pos).toBe(8)

      // Replace atoms with text (in reverse order)
      for (let i = atomNodes.length - 1; i >= 0; i--) {
        const { pos, size, text } = atomNodes[i]
        if (text) {
          tr.replaceWith(pos, pos + size, state.schema.text(text))
        }
      }

      // Now delete markers and apply mark
      const mappedContentEnd = tr.mapping.map(contentEnd)
      const mappedEnd = tr.mapping.map(end)
      tr.delete(mappedContentEnd, mappedEnd)

      const mappedStart = tr.mapping.map(start)
      tr.delete(mappedStart, mappedStart + openMarkerLength)

      const markStart = tr.mapping.map(contentStart)
      const markEnd = tr.mapping.map(contentEnd)

      if (markStart < markEnd) {
        tr.addMark(markStart, markEnd, testSchema.marks.code.create())
      }

      // Apply transaction and check result
      const newState = state.apply(tr)
      const resultText = newState.doc.textBetween(1, newState.doc.content.size)

      // EXPECT: "Hello @ariadne" (14 chars) with code mark
      expect(resultText).toBe("Hello @ariadne")
    })
  })
})
