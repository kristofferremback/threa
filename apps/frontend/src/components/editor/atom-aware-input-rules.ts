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
      for (let i = 0; i < node.text!.length; i++) {
        positionMap.push(pos + i)
        text += node.text![i]
      }
    } else if (node.isAtom && node.isInline) {
      // Atom nodes contribute a single character position
      // We use a placeholder that won't match the marker
      positionMap.push(pos)
      text += "\uFFFC" // Object replacement character
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
  const { openMarker, closeMarker, type, notPrecededBy } = config

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

      // range.to is where the closing marker ends (cursor position)
      // range.from is where the closing marker starts
      const closeMarkerStart = range.from
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

      // Delete the opening marker first (earlier in document)
      // This way the closing marker position remains valid
      tr.delete(openMarkerStart, textStart)

      // Map the closing marker position through the deletion
      const mappedCloseStart = tr.mapping.map(closeMarkerStart)
      const mappedCloseEnd = tr.mapping.map(closeMarkerEnd)

      // Delete the closing marker
      tr.delete(mappedCloseStart, mappedCloseEnd)

      // Calculate the mark range (after both deletions)
      // The content is now between openMarkerStart and mappedCloseStart
      const markFrom = openMarkerStart
      const markTo = mappedCloseStart

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
