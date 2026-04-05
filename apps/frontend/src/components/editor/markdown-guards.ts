import type { ResolvedPos } from "@tiptap/pm/model"
import type { EditorState } from "@tiptap/pm/state"

/**
 * Returns the plain text of `$pos`'s parent block from the block start up to
 * the cursor offset, with U+FFFC (object replacement character) for atom leaf
 * nodes so mentions/channels/emojis don't silently collapse into adjacent text.
 *
 * This is the canonical "what has the user typed so far in this block?" query
 * for composer trigger matchers and markdown input rules.
 */
export function getParentTextBefore($pos: ResolvedPos): string {
  return $pos.parent.textBetween(0, $pos.parentOffset, undefined, "\ufffc")
}

/**
 * Returns true if the "current word" ending at `$pos` contains a literal
 * backtick in its parent block.
 *
 * While a user is typing inside an unclosed inline-code segment (e.g.
 * `` `pull_request/... ``), the opening backtick is still a plain text
 * character in the document. Markdown-style input rules (bold, italic,
 * strike, code) and trigger characters (@, #, /, :) must be suppressed
 * inside that backtick-owned word until whitespace breaks the word, so
 * literal content like `` `f_name_2.py` `` is not silently reformatted
 * before the closing backtick is typed.
 *
 * The word boundary is any ASCII/Unicode whitespace or a `hardBreak` node;
 * atom nodes (mentions, channels, emojis, slash commands, attachments) are
 * neither whitespace nor backticks and extend the current word.
 *
 * Walks the parent children backwards from `$pos` and short-circuits at the
 * first whitespace or backtick so the common case runs in O(wordLength).
 */
export function currentWordContainsBacktick($pos: ResolvedPos): boolean {
  const parent = $pos.parent
  const targetOffset = $pos.parentOffset
  if (targetOffset <= 0) return false

  // Find the child index containing targetOffset and the offset within it.
  let childIndex = parent.childCount - 1
  let childStart = parent.content.size
  for (let i = parent.childCount - 1; i >= 0; i--) {
    const child = parent.child(i)
    childStart -= child.nodeSize
    if (childStart < targetOffset) {
      childIndex = i
      break
    }
  }

  let offsetInChild = targetOffset - childStart

  for (let i = childIndex; i >= 0; i--) {
    const child = parent.child(i)
    if (child.isText && child.text) {
      for (let j = offsetInChild - 1; j >= 0; j--) {
        const code = child.text.charCodeAt(j)
        if (isWordBreakCharCode(code)) return false
        if (code === 0x60 /* ` */) return true
      }
    } else if (child.type.name === "hardBreak") {
      return false
    }
    // Non-hardBreak atoms (mentions etc.) extend the word without terminating it.

    if (i > 0) offsetInChild = parent.child(i - 1).nodeSize
  }

  return false
}

function isWordBreakCharCode(code: number): boolean {
  // ASCII whitespace fast path.
  if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) return true
  // Broader Unicode whitespace (non-breaking space, ideographic space, etc.).
  // Rare in practice; escape hatch via regex on a single code point.
  return code > 0x7f && /\s/.test(String.fromCharCode(code))
}

export function isInBacktickWord(state: EditorState, pos: number): boolean {
  if (pos < 0 || pos > state.doc.content.size) return false
  try {
    return currentWordContainsBacktick(state.doc.resolve(pos))
  } catch {
    return false
  }
}
