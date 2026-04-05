import { InputRule } from "@tiptap/core"
import type { MarkType, Node as ProseMirrorNode } from "@tiptap/pm/model"
import { isInBacktickWord } from "./markdown-guards"

/**
 * Configuration for an atom-aware mark input rule.
 */
interface AtomAwareMarkInputRuleConfig {
  /** The opening marker (e.g., "**", "*", "`", "~~") */
  openMarker: string
  /** The closing marker (usually same as opening) */
  closeMarker: string
  /** The mark type to apply */
  type: MarkType
  /**
   * If true, atom nodes (like mentions) within the marked range will be converted
   * to their text representation. Use for inline code where you want raw text, not styled atoms.
   */
  convertAtomsToText?: boolean
}

/**
 * Create an input rule for marks that correctly handles atom nodes (like mentions).
 *
 * This uses a simpler approach than the previous implementation:
 * 1. Match the full pattern (opening + content + closing) using a regex
 * 2. Use TipTap's standard transaction modifications
 * 3. Only add atom-specific handling when needed
 */
export function atomAwareMarkInputRule(config: AtomAwareMarkInputRuleConfig): InputRule {
  const { openMarker, closeMarker, type, convertAtomsToText = false } = config

  // Build a regex that matches: opening marker, content (non-greedy), closing marker
  // The content must not start or end with whitespace
  const openEsc = escapeRegex(openMarker)
  const closeEsc = escapeRegex(closeMarker)

  // Markdown-style marks only apply when the opening marker is at the start of
  // the matched text window or immediately preceded by whitespace. This prevents
  // `f_name_2.py` from italicizing `name`, while still allowing `hi _friend_!`.
  // The `(?<=^|\s)` lookbehind enforces this and also naturally prevents
  // `**hello*` from matching as italic at position 1 (preceded by `*`, not
  // whitespace).
  //
  // For single-char markers we additionally require the content not to start
  // with the same marker char, so `***hello*` does not match as italic with
  // content `**hello`.

  let contentPattern: string
  const lookbehind = `(?<=^|\\s)`

  if (openMarker.length === 1) {
    const charExclusion = openEsc
    contentPattern = `[^\\s${charExclusion}]|[^\\s${charExclusion}][\\s\\S]*?[^\\s]`
  } else {
    contentPattern = `[^\\s]|[^\\s][\\s\\S]*?[^\\s]`
  }

  const pattern = new RegExp(`${lookbehind}${openEsc}(${contentPattern})${closeEsc}$`)

  return new InputRule({
    find: pattern,
    handler: ({ state, range, match }) => {
      const { tr } = state

      // match[1] is the content between markers
      const content = match[1]

      if (!content) return null

      // Calculate positions in original document
      // Note: range.from can be wrong when atom nodes (like mentions) have text representations
      // longer than their nodeSize. TipTap calculates positions based on text length, but
      // we need document positions. range.to is usually correct, so we find the opening
      // marker by searching backwards if range.from is invalid.
      let start = range.from
      const end = range.to

      // Bounds check - if start is negative, find the actual start by searching backwards
      if (start < 0 || start >= end) {
        // Search for opening marker in the document before end position
        const $end = state.doc.resolve(end)
        const parent = $end.parent
        const parentStart = end - $end.parentOffset

        // Walk through parent's children to find where the opening marker is
        let foundStart = -1
        let docPos = parentStart
        for (let i = 0; i < parent.childCount && docPos < end; i++) {
          const child = parent.child(i)
          if (child.isText && child.text) {
            // Check if this text node contains the opening marker
            const markerIndex = child.text.indexOf(openMarker)
            if (markerIndex !== -1) {
              // Found the marker - but we want the LAST occurrence before end
              // that could start our pattern
              let lastIndex = -1
              let searchFrom = 0
              while (true) {
                const idx = child.text.indexOf(openMarker, searchFrom)
                if (idx === -1 || docPos + idx >= end - closeMarker.length) break
                lastIndex = idx
                searchFrom = idx + 1
              }
              if (lastIndex !== -1) {
                foundStart = docPos + lastIndex
              }
            }
          }
          docPos += child.nodeSize
        }

        if (foundStart === -1) {
          return null // Couldn't find the opening marker
        }
        start = foundStart
      }

      const contentStart = start + openMarker.length

      // Count how many characters of the closing marker are actually in the document.
      // When typing, InputRule runs BEFORE the character is committed, so:
      // - For single-char markers: the char may be pending (0 in doc) or committed (1 in doc)
      // - For multi-char markers: some chars may be in doc, some pending
      //   e.g., for "**", first "*" may be in doc while second "*" is pending
      //
      // We check from end-1 backwards, matching against closeMarker from right to left.
      // This handles the case where the user has typed part of a multi-char marker.
      let closingCharsInDoc = 0
      try {
        for (let i = 0; i < closeMarker.length; i++) {
          const checkPos = end - 1 - i // Check from end-1 backwards
          const markerCharIndex = closeMarker.length - 1 - i // Match from right to left
          if (checkPos >= 0 && checkPos < state.doc.content.size) {
            const $pos = state.doc.resolve(checkPos)
            const nodeAfter = $pos.nodeAfter
            if (nodeAfter?.isText && nodeAfter.text?.charAt(0) === closeMarker.charAt(markerCharIndex)) {
              closingCharsInDoc++
            } else {
              break // Stop at first mismatch
            }
          } else {
            break // Position is beyond doc bounds
          }
        }
      } catch {
        // Position resolution failed
      }

      // Content ends at position (end - closingCharsInDoc):
      // - If closing marker is fully pending: closingCharsInDoc=0, contentEnd=end (content goes to cursor)
      // - If closing marker is fully in doc: closingCharsInDoc=markerLength, contentEnd=end-markerLength
      // - If partially pending: subtract only the chars that are in doc
      const contentEnd = end - closingCharsInDoc

      // Final bounds check
      // Note: contentEnd may be at or before docSize even when end > docSize (pending chars)
      if (start < 0 || contentStart < 0 || contentEnd < 0 || contentEnd <= contentStart) {
        return null
      }
      // Allow end to exceed docSize by the number of pending chars (closeMarker.length - closingCharsInDoc)
      const pendingChars = closeMarker.length - closingCharsInDoc
      if (end > state.doc.content.size + pendingChars) {
        return null
      }

      // Check if already marked (prevents double-application)
      const $start = state.doc.resolve(contentStart)
      if ($start.marks().some((m) => m.type === type)) {
        return null
      }

      // If the opening marker sits inside a word that still contains an
      // unclosed literal backtick (i.e. the user is typing inside what will
      // become inline code), suppress the mark. The user's text is still
      // "owned" by the pending backtick until the next whitespace breaks the
      // word. We skip this guard for the code mark itself, since the closing
      // backtick is exactly how that ownership is resolved.
      if (type.name !== "code" && isInBacktickWord(state, start)) {
        return null
      }

      // If convertAtomsToText, we need to handle atoms specially
      if (convertAtomsToText) {
        // Use end (not contentEnd) as the upper bound for nodesBetween
        // because contentEnd might equal the mention's position, excluding it
        const searchEnd = end
        const atomNodes: { pos: number; size: number; text: string }[] = []

        state.doc.nodesBetween(contentStart, searchEnd, (node, pos) => {
          const nodeEnd = pos + node.nodeSize
          const isInContentRange = pos < contentEnd && nodeEnd > contentStart

          // IMPORTANT: isAtom is true for ALL leaf nodes including text!
          // Must check !node.isText to only match actual atom nodes like mentions
          if (node.isAtom && node.isInline && !node.isText && isInContentRange) {
            // Get text representation from the node
            const attrs = node.attrs as { slug?: string }
            let text = ""

            // For mentions/channels, use the slug attribute directly (most reliable)
            if (attrs.slug) {
              let prefix = ""
              if (node.type.name === "mention") {
                prefix = "@"
              } else if (node.type.name === "channelLink") {
                prefix = "#"
              }
              text = `${prefix}${attrs.slug}`
            } else {
              // Try spec methods for other atom types
              const spec = node.type.spec as {
                leafText?: (n: ProseMirrorNode) => string
              }
              if (spec.leafText) {
                text = spec.leafText(node)
              } else {
                text = node.textContent || ""
              }
            }

            atomNodes.push({ pos, size: node.nodeSize, text })
          }
          return true
        })

        // Replace atoms with text (in reverse order)
        for (let i = atomNodes.length - 1; i >= 0; i--) {
          const { pos, size, text } = atomNodes[i]
          if (text) {
            tr.replaceWith(pos, pos + size, state.schema.text(text))
          } else {
            tr.delete(pos, pos + size)
          }
        }
      }

      // Map through any atom replacements
      const mappedStart = tr.mapping.map(start)
      const mappedContentEnd = tr.mapping.map(contentEnd)

      // Delete only the closing marker characters that are actually in the document
      // (Pending characters haven't been inserted yet)
      if (closingCharsInDoc > 0) {
        tr.delete(mappedContentEnd, mappedContentEnd + closingCharsInDoc)
      }

      // Delete opening marker
      tr.delete(mappedStart, mappedStart + openMarker.length)

      // Map the ORIGINAL content boundaries through ALL transformations
      // This gives us the correct positions in the final document
      const markStart = tr.mapping.map(contentStart)
      const markEnd = tr.mapping.map(contentEnd)

      // Apply the mark
      if (markStart < markEnd) {
        tr.addMark(markStart, markEnd, type.create())
      }

      // Remove stored mark so typing after doesn't continue the mark
      tr.removeStoredMark(type)
    },
  })
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
