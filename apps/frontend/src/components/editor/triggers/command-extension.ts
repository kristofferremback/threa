import { Extension } from "@tiptap/react"
import Suggestion from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"
import type { CommandItem } from "./types"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"

export const CommandPluginKey = new PluginKey("slashCommand")

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
 * Unlike mentions/channels, this replaces the trigger with plain text.
 */
export const CommandExtension = Extension.create<CommandOptions>({
  name: "slashCommand",

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
        pluginKey: CommandPluginKey,
        char: "/",
        allowSpaces: false,
        startOfLine: true, // Only trigger at start of message
        ...this.options.suggestion,
        command: ({ editor, range, props }) => {
          const command = props as CommandItem

          // Replace the trigger with the command name (plain text, not a node)
          // Keep a space so user can continue typing arguments
          editor.chain().focus().deleteRange(range).insertContent(`/${command.name} `).run()
        },
      }),
    ]
  },
})
