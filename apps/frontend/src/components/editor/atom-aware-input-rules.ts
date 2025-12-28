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

  // For single-char markers (*, _, `), we need two disambiguations:
  // 1. Content cannot START with the same char (prevents * matching content *foo* in **foo**)
  // 2. Opening marker cannot be PRECEDED by same char (prevents *foo* matching in **foo*)
  //
  // Example: For `**hello*`:
  // - Without (1): italic would match position 0 with content `*hello`
  // - Without (2): italic would match position 1 with content `hello`
  // - With both: italic correctly fails, waits for second closing `*`

  let contentPattern: string
  let lookbehind = ""

  if (openMarker.length === 1) {
    // Single-char marker: add lookbehind and content-start exclusion
    lookbehind = `(?<!${openEsc})`
    const charExclusion = openEsc
    contentPattern = `[^\\s${charExclusion}]|[^\\s${charExclusion}][\\s\\S]*?[^\\s]`
  } else {
    // Multi-char marker: standard pattern, no lookbehind needed
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

      // Check if the closing marker is actually in the document
      // When typing, InputRule runs BEFORE the character is committed
      // In that case, we shouldn't subtract closeMarker.length from end
      let closingMarkerInDoc = false
      try {
        // The closing marker would be at position (end - closeMarker.length) if committed
        // Check if there's text there that matches the closing marker
        if (end <= state.doc.content.size) {
          const potentialMarkerPos = end - closeMarker.length
          if (potentialMarkerPos >= 0 && potentialMarkerPos < state.doc.content.size) {
            const $pos = state.doc.resolve(potentialMarkerPos)
            const nodeAfter = $pos.nodeAfter
            closingMarkerInDoc = !!(nodeAfter?.isText && nodeAfter.text?.startsWith(closeMarker))
          }
        }
      } catch {
        // Position resolution failed, marker not in doc
      }

      // If closing marker is in doc, content ends before it
      // If closing marker is pending (not in doc), content goes to end
      const contentEnd = closingMarkerInDoc ? end - closeMarker.length : end

      // DEBUG: Log all positions to diagnose the issue
      console.log("[atom-aware] HANDLER CALLED:", {
        marker: openMarker,
        matchedContent: content,
        rangeFrom: range.from,
        rangeTo: range.to,
        calculatedStart: start,
        end,
        contentStart,
        contentEnd,
        closingMarkerInDoc,
        docSize: state.doc.content.size,
        docText: state.doc.textBetween(0, Math.min(50, state.doc.content.size)),
      })

      // Final bounds check
      if (start < 0 || contentStart < 0 || contentEnd < 0 || contentEnd <= contentStart) {
        console.log("[atom-aware] ABORTING: bounds check failed", { start, contentStart, contentEnd })
        return null
      }
      if (end > state.doc.content.size) {
        console.log("[atom-aware] ABORTING: end > docSize", { end, docSize: state.doc.content.size })
        return null
      }

      // Check if already marked (prevents double-application)
      const $start = state.doc.resolve(contentStart)
      if ($start.marks().some((m) => m.type === type)) {
        console.log("[atom-aware] ABORTING: already marked")
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
            // Try renderText from the node's type spec (set by TipTap extensions)
            let text = ""
            const spec = node.type.spec as { renderText?: (props: { node: typeof node }) => string }
            if (spec.renderText) {
              text = spec.renderText({ node })
            } else {
              text = node.textContent || ""
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
      const mappedEnd = tr.mapping.map(end)
      const mappedContentEnd = tr.mapping.map(contentEnd)

      // DEBUG: Log mapped positions
      console.log("[atom-aware] BEFORE DELETIONS:", {
        mappedStart,
        mappedEnd,
        mappedContentEnd,
        closingMarkerInDoc,
        deleteClosing: closingMarkerInDoc
          ? `[${mappedContentEnd}, ${mappedContentEnd + closeMarker.length})`
          : "SKIPPED (pending)",
        deleteOpening: `[${mappedStart}, ${mappedStart + openMarker.length})`,
      })

      // Delete closing marker only if it's actually in the document
      // (When typing, it's pending and hasn't been inserted yet)
      if (closingMarkerInDoc) {
        tr.delete(mappedContentEnd, mappedContentEnd + closeMarker.length)
      }

      // Delete opening marker
      tr.delete(mappedStart, mappedStart + openMarker.length)

      // Map the ORIGINAL content boundaries through ALL transformations
      // This gives us the correct positions in the final document
      const markStart = tr.mapping.map(contentStart)
      const markEnd = tr.mapping.map(contentEnd)

      // Apply the mark
      console.log("[atom-aware] APPLYING MARK:", { markStart, markEnd, markType: type.name })
      if (markStart < markEnd) {
        tr.addMark(markStart, markEnd, type.create())
      }

      // Remove stored mark so typing after doesn't continue the mark
      tr.removeStoredMark(type)
      console.log("[atom-aware] HANDLER COMPLETE - transaction applied")
    },
  })
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
