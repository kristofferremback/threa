/**
 * TipTap extension for `type:` filter trigger in search mode.
 * Shows stream type options (scratchpad, channel, dm, thread) when user types `type:`.
 *
 * Unlike mention/channel extensions, this inserts plain text, not a node.
 */
import { Extension } from "@tiptap/core"
import Suggestion from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"

export const FilterTypePluginKey = new PluginKey("filterType")

export interface FilterTypeItem {
  id: string
  value: string
  label: string
  description: string
}

export const FILTER_TYPE_OPTIONS: FilterTypeItem[] = [
  { id: "scratchpad", value: "scratchpad", label: "Scratchpad", description: "Personal notes and AI companion" },
  { id: "channel", value: "channel", label: "Channel", description: "Public or private team channels" },
  { id: "dm", value: "dm", label: "Direct Message", description: "One-on-one conversations" },
  { id: "thread", value: "thread", label: "Thread", description: "Nested discussions" },
]

export interface FilterTypeOptions {
  suggestion: {
    items: (props: { query: string }) => FilterTypeItem[] | Promise<FilterTypeItem[]>
    render: () => {
      onStart: (props: SuggestionProps<FilterTypeItem>) => void
      onUpdate: (props: SuggestionProps<FilterTypeItem>) => void
      onExit: () => void
      onKeyDown: (props: SuggestionKeyDownProps) => boolean
    }
  }
}

/**
 * Custom match function for `type:` trigger.
 * Detects when user types `type:` followed by optional characters.
 *
 * Uses TipTap's Trigger interface which provides $position for cursor context.
 */
function findFilterTypeMatch(config: {
  char: string
  allowSpaces: boolean
  allowedPrefixes: string[] | null
  startOfLine: boolean
  $position: import("@tiptap/pm/model").ResolvedPos
}) {
  const { $position } = config

  // Get text from start of text block to cursor
  const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, "\ufffc")

  // Match `type:` at word boundary (start of text or after whitespace)
  // Also match after `?` since search mode uses `?` prefix
  const match = textBefore.match(/(?:^|\s|\?)(type:)(\S*)$/)
  if (!match) return null

  const fullMatch = match[0]
  const triggerPart = match[1] // "type:"
  const query = match[2] || "" // characters after "type:"

  // Calculate positions relative to document
  const matchStart = $position.pos - fullMatch.length + (fullMatch.startsWith(" ") ? 1 : 0)

  return {
    range: { from: matchStart, to: $position.pos },
    query,
    text: triggerPart + query,
  }
}

export const FilterTypeExtension = Extension.create<FilterTypeOptions>({
  name: "filterType",

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
        pluginKey: FilterTypePluginKey,
        char: "type:",
        allowSpaces: false,
        // Custom matching function for multi-character trigger
        findSuggestionMatch: findFilterTypeMatch,
        ...this.options.suggestion,
        command: ({ editor, range, props }) => {
          const item = props as FilterTypeItem
          // Insert plain text: "type:value "
          editor.chain().focus().deleteRange(range).insertContent(`type:${item.value} `).run()
        },
      }),
    ]
  },
})
