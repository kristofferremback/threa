/**
 * TipTap extension for `in:` and `in:#` filter trigger in search mode.
 * Shows stream/channel suggestions when user types `in:` or `in:#`.
 * Inserts plain text: `in:#slug `
 *
 * Examples:
 * - `in:` → shows all streams
 * - `in:#` → shows all streams
 * - `in:gen` → shows streams matching "gen"
 * - `in:#gen` → shows streams matching "gen"
 * - `in:@` → NOT matched (handled by in-user-filter-extension for DMs)
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
 * Custom match function for `in:` and `in:#` trigger (for stream filtering).
 * Matches `in:` or `in:#` followed by optional query, but NOT `in:@`.
 * Uses negative lookahead to avoid matching `in:@` (user/DM filter).
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

  // Match `in:` or `in:#` at word boundary, but NOT if followed by @
  // - `in:` → matches (shows streams)
  // - `in:#` → matches (shows streams)
  // - `in:gen` → matches (query="gen")
  // - `in:#gen` → matches (query="gen")
  // - `in:@` → does NOT match (handled by in-user-filter-extension)
  const match = textBefore.match(/(?:^|\s|\?)(in:#?)(?!@)(\S*)$/)
  if (!match) return null

  const fullMatch = match[0]
  const triggerPart = match[1] // "in:" or "in:#"
  const query = match[2] || "" // characters after trigger

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
        char: "in:", // Base trigger, custom match function handles both in: and in:#
        allowSpaces: false,
        findSuggestionMatch: findInChannelFilterMatch,
        ...this.options.suggestion,
        command: ({ editor, range, props }) => {
          const item = props as ChannelItem
          // Always insert "in:#slug " regardless of whether user typed in: or in:#
          editor.chain().focus().deleteRange(range).insertContent(`in:#${item.slug} `).run()
        },
      }),
    ]
  },
})
