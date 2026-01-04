import { Node, mergeAttributes } from "@tiptap/react"
import { InputRule } from "@tiptap/core"
import Suggestion from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"
import type { EmojiEntry } from "@threa/types"

export const EmojiPluginKey = new PluginKey("emoji")

export interface EmojiNodeAttrs {
  shortcode: string
  emoji: string
}

export interface EmojiExtensionOptions {
  suggestion: {
    items: (props: { query: string }) => EmojiEntry[] | Promise<EmojiEntry[]>
    render: () => {
      onStart: (props: SuggestionProps<EmojiEntry>) => void
      onUpdate: (props: SuggestionProps<EmojiEntry>) => void
      onExit: () => void
      onKeyDown: (props: SuggestionKeyDownProps) => boolean
    }
  }
  /** Look up emoji by shortcode - used for input rule auto-convert */
  toEmoji: (shortcode: string) => string | null
}

/**
 * TipTap extension for :emoji: shortcuts.
 *
 * Features:
 * - Suggestion popup when typing ":" followed by query
 * - Input rule to auto-convert :shortcode: to emoji node
 * - Displays emoji character, serializes as :shortcode:
 */
export const EmojiExtension = Node.create<EmojiExtensionOptions>({
  name: "emoji",
  group: "inline",
  inline: true,
  selectable: false,
  atom: true,
  marks: "_", // Allow all marks (bold, italic, etc.)

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
      toEmoji: () => null,
    }
  },

  addAttributes() {
    return {
      shortcode: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-shortcode"),
        renderHTML: (attrs) => ({ "data-shortcode": attrs.shortcode }),
      },
      emoji: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-emoji"),
        renderHTML: (attrs) => ({ "data-emoji": attrs.emoji }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="emoji"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "emoji",
        class: "inline-block",
      }),
      node.attrs.emoji, // Display the emoji character
    ]
  },

  // For copy/paste - serialize as :shortcode:
  renderText({ node }) {
    return `:${node.attrs.shortcode}:`
  },

  addInputRules() {
    const { toEmoji } = this.options

    // Auto-convert :shortcode: to emoji node when closing colon is typed
    return [
      new InputRule({
        find: /:([a-z0-9_+-]+):$/,
        handler: ({ state, range, match, chain }) => {
          const shortcode = match[1]
          const emoji = toEmoji(shortcode)
          if (!emoji) return null

          const nodeType = this.type

          // Get marks at current position to preserve styling
          const $from = state.doc.resolve(range.from)
          const { storedMarks } = state
          const currentMarks = storedMarks || $from.marks()
          const marks = currentMarks.map((mark: { type: { name: string }; attrs: Record<string, unknown> }) => ({
            type: mark.type.name,
            attrs: mark.attrs,
          }))

          // Replace the :shortcode: with an emoji node using chain
          chain()
            .deleteRange(range)
            .insertContent([{ type: nodeType.name, attrs: { shortcode, emoji }, marks }])
            .run()
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: EmojiPluginKey,
        char: ":",
        allowSpaces: false,
        startOfLine: false,
        // Only allow if character after : is valid shortcode char
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)

          // Check if inside a code block
          for (let depth = $from.depth; depth >= 0; depth--) {
            const node = $from.node(depth)
            if (node.type.name === "codeBlock") {
              return false
            }
          }

          // Check if cursor position has code mark
          const marks = $from.marks()
          if (marks.some((mark) => mark.type.name === "code")) {
            return false
          }

          // Check stored marks too
          const storedMarks = state.storedMarks || $from.marks()
          if (storedMarks.some((mark) => mark.type.name === "code")) {
            return false
          }

          return true
        },
        ...this.options.suggestion,
        command: ({ editor, range, props }) => {
          const item = props as EmojiEntry
          const attrs: EmojiNodeAttrs = {
            shortcode: item.shortcode,
            emoji: item.emoji,
          }

          // Get marks at the current position to preserve styling
          const { $from } = editor.state.selection
          const { storedMarks } = editor.state
          const currentMarks = storedMarks || $from.marks()
          const marks = currentMarks.map((mark: { type: { name: string }; attrs: Record<string, unknown> }) => ({
            type: mark.type.name,
            attrs: mark.attrs,
          }))

          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: "emoji", attrs, marks },
              { type: "text", text: " ", marks },
            ])
            .run()
        },
      }),
    ]
  },
})
