import { describe, it, expect } from "vitest"
import { Schema } from "@tiptap/pm/model"
import { EditorState } from "@tiptap/pm/state"
import { isInBacktickWord, currentWordContainsBacktick } from "./markdown-guards"

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
})

function stateWithParagraph(text: string): EditorState {
  const doc = schema.nodes.doc.create({}, [schema.nodes.paragraph.create({}, [schema.text(text)])])
  return EditorState.create({ doc, schema })
}

describe("currentWordContainsBacktick", () => {
  it("returns false at the start of a paragraph", () => {
    const state = stateWithParagraph("hello")
    expect(isInBacktickWord(state, 1)).toBe(false)
  })

  it("returns false when the current word has no backtick", () => {
    const state = stateWithParagraph("hi _friend_")
    // Position at the end (after the closing underscore).
    expect(isInBacktickWord(state, state.doc.content.size - 1)).toBe(false)
  })

  it("returns true inside an unclosed backtick word", () => {
    // Matches the user's reproducer `pull_request/{review.rs,review_comment.rs}`
    // (with the closing backtick not yet typed).
    const state = stateWithParagraph("`pull_request/{review.rs,review_comment.rs}")
    expect(isInBacktickWord(state, state.doc.content.size - 1)).toBe(true)
  })

  it("returns true when the backtick appears mid-word", () => {
    const state = stateWithParagraph("x`foo_bar")
    expect(isInBacktickWord(state, state.doc.content.size - 1)).toBe(true)
  })

  it("returns false after whitespace breaks the backtick word", () => {
    // `f _name_ — the cursor at the end sits in a new word that no longer
    // contains a backtick.
    const state = stateWithParagraph("`f _name_")
    expect(isInBacktickWord(state, state.doc.content.size - 1)).toBe(false)
  })

  it("returns false for a brand-new word after any prior backtick", () => {
    const state = stateWithParagraph("`foo bar")
    // At the end of "bar" — prior word had the backtick, current word does not.
    expect(isInBacktickWord(state, state.doc.content.size - 1)).toBe(false)
  })

  it("uses ResolvedPos API directly", () => {
    const state = stateWithParagraph("`abc")
    const $pos = state.doc.resolve(state.doc.content.size - 1)
    expect(currentWordContainsBacktick($pos)).toBe(true)
  })
})
