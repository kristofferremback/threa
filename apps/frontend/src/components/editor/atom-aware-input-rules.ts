import { InputRule } from "@tiptap/core"
import type { MarkType } from "@tiptap/pm/model"
import type { EditorState } from "@tiptap/pm/state"

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
   * Characters that, if preceding the closing marker, mean this rule shouldn't fire.
   * Used to prevent single-char markers from matching when part of a multi-char marker.
   * e.g., italic (*) shouldn't match when closing marker is preceded by * (making it **)
   */
  notPrecededBy?: string
  /**
   * If true, atom nodes (like mentions) within the marked range will be converted
   * to their text representation. Use for inline code where you want raw text, not styled atoms.
   */
  convertAtomsToText?: boolean
}

/**
 * Find the position of the opening marker by walking backward through the document.
 * This correctly handles atom nodes (like mentions) that don't have text content.
 */
function findOpeningMarker(
  state: EditorState,
  closePos: number,
  openMarker: string,
  notPrecededBy?: string
): { from: number; textStart: number } | null {
  const { doc } = state

  // Get the text content before the cursor position
  // We need to walk the document to find the opening marker
  const $pos = doc.resolve(closePos)

  // Start from the beginning of the current text block
  const blockStart = closePos - $pos.parentOffset

  // Walk through the text block to find content and opening marker
  let text = ""
  const positionMap: number[] = [] // Maps string index to document position

  doc.nodesBetween(blockStart, closePos, (node, pos) => {
    if (node.isText) {
      // Only include characters up to closePos (nodesBetween visits the whole node)
      // Skip if node starts at or after closePos
      if (pos >= closePos) return true
      const endOffset = Math.min(node.text!.length, closePos - pos)
      for (let i = 0; i < endOffset; i++) {
        positionMap.push(pos + i)
        text += node.text![i]
      }
    } else if (node.isAtom && node.isInline) {
      // Only include atom if it's before closePos
      if (pos < closePos) {
        // Atom nodes contribute a single character position
        // We use a placeholder that won't match the marker
        positionMap.push(pos)
        text += "\uFFFC" // Object replacement character
      }
    }
    return true
  })

  // Find the opening marker in the text (searching from the end, skipping invalid matches)
  let markerIndex = text.length
  while (true) {
    markerIndex = text.lastIndexOf(openMarker, markerIndex - 1)
    if (markerIndex === -1) return null

    // Check if this marker is preceded by the excluded character
    if (notPrecededBy && markerIndex > 0 && text[markerIndex - 1] === notPrecededBy) {
      // Skip this match, it's part of a larger marker (e.g., * is part of **)
      continue
    }

    // Check if the character after the marker is the excluded character
    // This prevents matching ** when looking for single *
    if (notPrecededBy && text[markerIndex + openMarker.length] === notPrecededBy) {
      continue
    }

    break
  }

  // Make sure there's content between the markers
  const contentBetween = text.slice(markerIndex + openMarker.length)
  if (!contentBetween.replace(/\uFFFC/g, "").trim()) return null

  // Map back to document positions
  const from = positionMap[markerIndex]
  const textStart = positionMap[markerIndex + openMarker.length]

  if (from === undefined || textStart === undefined) return null

  return { from, textStart }
}

/**
 * Create an input rule for marks that correctly handles atom nodes (like mentions).
 *
 * The standard TipTap markInputRule uses regex on text content, which doesn't
 * account for atom nodes properly. This implementation:
 * 1. Detects when the user types the closing marker
 * 2. Walks backward through the document (including atom nodes) to find the opening marker
 * 3. Calculates correct document positions
 * 4. Applies the mark to the full range
 */
export function atomAwareMarkInputRule(config: AtomAwareMarkInputRuleConfig): InputRule {
  const { openMarker, closeMarker, type, notPrecededBy, convertAtomsToText = false } = config

  // Create regex that matches the closing marker at the end
  // If notPrecededBy is set, use negative lookbehind to prevent matching
  let patternStr = escapeRegex(closeMarker) + "$"
  if (notPrecededBy) {
    patternStr = `(?<!${escapeRegex(notPrecededBy)})` + patternStr
  }
  const closePattern = new RegExp(patternStr)

  return new InputRule({
    find: closePattern,
    handler: ({ state, range }) => {
      const { tr } = state
      const { doc } = state

      // range.to is where the closing marker ends (cursor position)
      // range.from is where the closing marker starts
      let closeMarkerStart = range.from
      const closeMarkerEnd = range.to

      // Find the opening marker
      const opening = findOpeningMarker(state, closeMarkerStart, openMarker, notPrecededBy)
      if (!opening) return null

      const { from: openMarkerStart, textStart } = opening

      // Verify we're not applying to already-marked content
      // (prevents double-application on undo/redo)
      const $from = state.doc.resolve(textStart)
      if ($from.marks().some((m) => m.type === type)) {
        return null
      }

      // Check for trailing whitespace before the closing marker
      // e.g., "~~hello @ariadne ~~" should become "~~hello @ariadne~~"
      let trailingSpaceStart = closeMarkerStart
      const $closePos = doc.resolve(closeMarkerStart)
      if ($closePos.nodeBefore?.isText) {
        const textBefore = $closePos.nodeBefore.text || ""
        const trailingMatch = textBefore.match(/\s+$/)
        if (trailingMatch) {
          // Adjust to include trailing whitespace in deletion
          trailingSpaceStart = closeMarkerStart - trailingMatch[0].length
        }
      }

      // If convertAtomsToText is true, replace atom nodes with their text content
      // This is needed for inline code where atoms should become plain text
      if (convertAtomsToText) {
        // Collect atom nodes in the range (in reverse order to maintain positions)
        const atomNodes: { pos: number; size: number; text: string }[] = []
        doc.nodesBetween(textStart, closeMarkerStart, (node, pos) => {
          if (node.isAtom && node.isInline) {
            // Get text representation via textContent (uses renderText if defined)
            const text = node.textContent || ""
            atomNodes.push({ pos, size: node.nodeSize, text })
          }
          return true
        })

        // Replace atoms with text nodes (in reverse order to maintain positions)
        for (let i = atomNodes.length - 1; i >= 0; i--) {
          const { pos, size, text } = atomNodes[i]
          tr.replaceWith(pos, pos + size, state.schema.text(text))
        }

        // Don't manually remap here - let tr.mapping.map() handle all remapping at the end
      }

      // Delete the opening marker first (earlier in document)
      // This way the closing marker position remains valid
      tr.delete(openMarkerStart, textStart)

      // Map ALL original positions through the accumulated transaction mapping
      // This handles both atom replacements (if any) and the marker deletion
      const mappedTrailingStart = tr.mapping.map(trailingSpaceStart)
      const mappedCloseEnd = tr.mapping.map(closeMarkerEnd)

      // Delete trailing whitespace + closing marker
      tr.delete(mappedTrailingStart, mappedCloseEnd)

      // Calculate the mark range (after both deletions)
      // openMarkerStart is still valid (nothing before it was modified)
      // The content end is mappedTrailingStart (position where we deleted from)
      const markFrom = openMarkerStart
      const markTo = mappedTrailingStart

      // Apply the mark
      tr.addMark(markFrom, markTo, type.create())

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
