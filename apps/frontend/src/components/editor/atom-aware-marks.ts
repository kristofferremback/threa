/**
 * Custom mark extensions with atom-aware input rules.
 *
 * TipTap's default input rules for marks (bold, italic, code, strike) don't
 * handle atom nodes (like mentions) correctly. When you type **Hello @mention world**,
 * the standard input rule miscalculates positions and corrupts the content.
 *
 * These extensions replace the default input rules with atom-aware versions
 * that correctly walk the document structure.
 */

import { Bold } from "@tiptap/extension-bold"
import { Italic } from "@tiptap/extension-italic"
import { Strike } from "@tiptap/extension-strike"
import { Code } from "@tiptap/extension-code"
import { atomAwareMarkInputRule } from "./atom-aware-input-rules"

/**
 * Bold extension with atom-aware input rules.
 * Typing **text** or __text__ converts to bold, even with mentions inside.
 */
export const AtomAwareBold = Bold.extend({
  addInputRules() {
    return [
      atomAwareMarkInputRule({
        openMarker: "**",
        closeMarker: "**",
        type: this.type,
      }),
      atomAwareMarkInputRule({
        openMarker: "__",
        closeMarker: "__",
        type: this.type,
      }),
    ]
  },
})

/**
 * Italic extension with atom-aware input rules.
 * Typing *text* or _text_ converts to italic, even with mentions inside.
 * Uses notPrecededBy to avoid matching ** (bold) when looking for * (italic).
 */
export const AtomAwareItalic = Italic.extend({
  addInputRules() {
    return [
      atomAwareMarkInputRule({
        openMarker: "*",
        closeMarker: "*",
        type: this.type,
        notPrecededBy: "*", // Don't match if part of ** (bold)
      }),
      atomAwareMarkInputRule({
        openMarker: "_",
        closeMarker: "_",
        type: this.type,
        notPrecededBy: "_", // Don't match if part of __ (bold)
      }),
    ]
  },
})

/**
 * Strike extension with atom-aware input rules.
 * Typing ~~text~~ converts to strikethrough, even with mentions inside.
 */
export const AtomAwareStrike = Strike.extend({
  addInputRules() {
    return [
      atomAwareMarkInputRule({
        openMarker: "~~",
        closeMarker: "~~",
        type: this.type,
      }),
    ]
  },
})

/**
 * Code extension with atom-aware input rules.
 * Typing `text` converts to inline code, even with mentions inside.
 */
export const AtomAwareCode = Code.extend({
  addInputRules() {
    return [
      atomAwareMarkInputRule({
        openMarker: "`",
        closeMarker: "`",
        type: this.type,
      }),
    ]
  },
})
