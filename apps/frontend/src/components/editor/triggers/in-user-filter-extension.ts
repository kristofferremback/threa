/**
 * TipTap extension for `in:@` filter trigger in search mode.
 * Shows user/persona suggestions when user types `in:@` (for DM filtering).
 * Inserts plain text: `in:@slug `
 */
import { Extension } from "@tiptap/core"
import Suggestion from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"
import type { Mentionable } from "./types"

export const InUserFilterPluginKey = new PluginKey("inUserFilter")

export interface InUserFilterOptions {
  suggestion: {
    items: (props: { query: string }) => Mentionable[] | Promise<Mentionable[]>
    render: () => {
      onStart: (props: SuggestionProps<Mentionable>) => void
      onUpdate: (props: SuggestionProps<Mentionable>) => void
      onExit: () => void
      onKeyDown: (props: SuggestionKeyDownProps) => boolean
    }
  }
}

/**
 * Custom match function for `in:@` trigger.
 * Detects when user types `in:@` followed by optional characters.
 */
function findInUserFilterMatch(config: {
  char: string
  allowSpaces: boolean
  allowedPrefixes: string[] | null
  startOfLine: boolean
  $position: import("@tiptap/pm/model").ResolvedPos
}) {
  const { $position } = config

  // Get text from start of text block to cursor
  const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, "\ufffc")

  // Match `in:@` at word boundary (start of text or after whitespace)
  const match = textBefore.match(/(?:^|\s)(in:@)(\S*)$/)
  if (!match) return null

  const fullMatch = match[0]
  const triggerPart = match[1] // "in:@"
  const query = match[2] || "" // characters after "in:@"

  // Calculate positions relative to document
  const matchStart = $position.pos - fullMatch.length + (fullMatch.startsWith(" ") ? 1 : 0)

  return {
    range: { from: matchStart, to: $position.pos },
    query,
    text: triggerPart + query,
  }
}

export const InUserFilterExtension = Extension.create<InUserFilterOptions>({
  name: "inUserFilter",

  addOptions() {
    return {
      suggestion: {
        items: () => [],
        render: () => ({
          onStart: () => {},
          onUpdate: () => {},
          onExit: () => {},
          onKeyDown: () => false,
        }),
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: InUserFilterPluginKey,
        char: "in:@",
        allowSpaces: false,
        findSuggestionMatch: findInUserFilterMatch,
        ...this.options.suggestion,
        command: ({ editor, range, props }) => {
          const item = props as Mentionable
          // Insert plain text: "in:@slug "
          editor.chain().focus().deleteRange(range).insertContent(`in:@${item.slug} `).run()
        },
      }),
    ]
  },
})
