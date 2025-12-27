import { Node, mergeAttributes } from "@tiptap/react"
import Suggestion from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"
import type { CommandItem } from "./types"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"

export const CommandPluginKey = new PluginKey("slashCommand")

export interface CommandNodeAttrs {
  name: string
}

export interface CommandOptions {
  suggestion: {
    items: (props: { query: string }) => CommandItem[] | Promise<CommandItem[]>
    render: () => {
      onStart: (props: SuggestionProps<CommandItem>) => void
      onUpdate: (props: SuggestionProps<CommandItem>) => void
      onExit: () => void
      onKeyDown: (props: SuggestionKeyDownProps) => boolean
    }
  }
}

/**
 * TipTap extension for /slash commands.
 * Creates an inline node that renders as a styled command chip.
 */
export const CommandExtension = Node.create<CommandOptions>({
  name: "slashCommand",
  group: "inline",
  inline: true,
  selectable: false,
  atom: true,

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

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-name"),
        renderHTML: (attributes) => ({ "data-name": attributes.name }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="slashCommand"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "slashCommand",
        class: "inline-flex items-center rounded px-1 py-0.5 text-sm font-mono font-bold bg-muted text-primary",
      }),
      `/${node.attrs.name}`,
    ]
  },

  renderText({ node }) {
    return `/${node.attrs.name}`
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: CommandPluginKey,
        char: "/",
        allowSpaces: false,
        startOfLine: true, // Only trigger at start of message
        ...this.options.suggestion,
        command: ({ editor, range, props }) => {
          const command = props as CommandItem

          // Delete the trigger and query, then insert the command node
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: this.name,
                attrs: { name: command.name },
              },
              { type: "text", text: " " },
            ])
            .run()
        },
      }),
    ]
  },
})
