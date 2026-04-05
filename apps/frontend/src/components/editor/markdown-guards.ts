import type { ResolvedPos } from "@tiptap/pm/model"
import type { EditorState } from "@tiptap/pm/state"

/**
 * Returns true if the "current word" (the run of non-whitespace text ending at
 * the given position within its parent block) contains a literal backtick.
 *
 * Rationale: while a user is typing inside an unclosed inline-code segment
 * (e.g. `` `pull_request/... ``), the opening backtick is still a plain text
 * character in the document. Markdown-style input rules (bold, italic, strike,
 * code) and trigger characters (@, #, /, :) should be suppressed inside that
 * backtick-owned word until whitespace breaks the word, so that literal
 * content like `` `f_name_2.py` `` is not secretly reformatted before the
 * closing backtick is typed.
 */
export function currentWordContainsBacktick($pos: ResolvedPos): boolean {
  const parent = $pos.parent
  const parentOffset = $pos.parentOffset
  if (parentOffset <= 0) return false
  // Use \ufffc as the leaf replacement so atom nodes don't look like whitespace
  // or backticks.
  const text = parent.textBetween(0, parentOffset, undefined, "\ufffc")
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text.charCodeAt(i)
    // Whitespace terminates the current word.
    if (ch === 0x20 /* space */ || ch === 0x09 /* tab */ || ch === 0x0a /* \n */ || ch === 0x0d /* \r */) {
      return false
    }
    if (ch === 0x60 /* backtick */) {
      return true
    }
  }
  return false
}

export function isInBacktickWord(state: EditorState, pos: number): boolean {
  if (pos < 0 || pos > state.doc.content.size) return false
  try {
    return currentWordContainsBacktick(state.doc.resolve(pos))
  } catch {
    return false
  }
}
