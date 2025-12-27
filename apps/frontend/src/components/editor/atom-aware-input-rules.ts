import { InputRule } from "@tiptap/core"
import type { MarkType } from "@tiptap/pm/model"

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

  // Pattern: opening + non-whitespace + (anything) + non-whitespace + closing
  // Or: opening + single non-whitespace char + closing
  const pattern = new RegExp(`${openEsc}([^\\s]|[^\\s][\\s\\S]*?[^\\s])${closeEsc}$`)

  return new InputRule({
    find: pattern,
    handler: ({ state, range, match }) => {
      const { tr } = state

      // match[1] is the content between markers
      const content = match[1]

      if (!content) return null

      // Calculate positions
      const start = range.from
      const end = range.to

      // Check if already marked (prevents double-application)
      const $start = state.doc.resolve(start + openMarker.length)
      if ($start.marks().some((m) => m.type === type)) {
        return null
      }

      // If convertAtomsToText, we need to handle atoms specially
      if (convertAtomsToText) {
        // Collect atoms in the content range
        const contentStart = start + openMarker.length
        const contentEnd = end - closeMarker.length
        const atomNodes: { pos: number; size: number; text: string }[] = []

        state.doc.nodesBetween(contentStart, contentEnd, (node, pos) => {
          if (node.isAtom && node.isInline && pos >= contentStart && pos < contentEnd) {
            const text = node.textContent || ""
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

      // Map positions through any atom replacements
      const mappedStart = tr.mapping.map(start)
      const mappedEnd = tr.mapping.map(end)

      // Delete the markers and apply the mark
      // Calculate content boundaries
      const contentEnd = mappedEnd - closeMarker.length

      // Delete closing marker first
      tr.delete(contentEnd, mappedEnd)

      // Delete opening marker
      tr.delete(mappedStart, mappedStart + openMarker.length)

      // Calculate final mark range (after both deletions)
      const markStart = mappedStart
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
