/**
 * TipTap extension for `in:#` filter trigger in search mode.
 * Shows channel suggestions when user types `in:#`.
 * Inserts plain text: `in:#slug `
 */
import { Extension } from "@tiptap/core"
import Suggestion from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"
import type { ChannelItem } from "./types"

export const InChannelFilterPluginKey = new PluginKey("inChannelFilter")

export interface InChannelFilterOptions {
  suggestion: {
    items: (props: { query: string }) => ChannelItem[] | Promise<ChannelItem[]>
    render: () => {
      onStart: (props: SuggestionProps<ChannelItem>) => void
      onUpdate: (props: SuggestionProps<ChannelItem>) => void
      onExit: () => void
      onKeyDown: (props: SuggestionKeyDownProps) => boolean
    }
  }
}

/**
 * Custom match function for `in:#` trigger.
 * Detects when user types `in:#` followed by optional characters.
 */
function findInChannelFilterMatch(config: {
  char: string
  allowSpaces: boolean
  allowedPrefixes: string[] | null
  startOfLine: boolean
  $position: import("@tiptap/pm/model").ResolvedPos
}) {
  const { $position } = config

  // Get text from start of text block to cursor
  const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, "\ufffc")

  // Match `in:#` at word boundary (start of text or after whitespace)
  const match = textBefore.match(/(?:^|\s)(in:#)(\S*)$/)
  if (!match) return null

  const fullMatch = match[0]
  const triggerPart = match[1] // "in:#"
  const query = match[2] || "" // characters after "in:#"

  // Calculate positions relative to document
  const matchStart = $position.pos - fullMatch.length + (fullMatch.startsWith(" ") ? 1 : 0)

  return {
    range: { from: matchStart, to: $position.pos },
    query,
    text: triggerPart + query,
  }
}

export const InChannelFilterExtension = Extension.create<InChannelFilterOptions>({
  name: "inChannelFilter",

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
        pluginKey: InChannelFilterPluginKey,
        char: "in:#",
        allowSpaces: false,
        findSuggestionMatch: findInChannelFilterMatch,
        ...this.options.suggestion,
        command: ({ editor, range, props }) => {
          const item = props as ChannelItem
          // Insert plain text: "in:#slug "
          editor.chain().focus().deleteRange(range).insertContent(`in:#${item.slug} `).run()
        },
      }),
    ]
  },
})
