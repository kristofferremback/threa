import { Node, mergeAttributes } from "@tiptap/react"
import Suggestion from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"
import type { ChannelItem } from "./types"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"

export const ChannelPluginKey = new PluginKey("channel")

export interface ChannelNodeAttrs {
  id: string
  slug: string
}

export interface ChannelOptions {
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
 * TipTap extension for #channel links.
 * Creates an inline node that renders as a styled channel chip.
 */
export const ChannelExtension = Node.create<ChannelOptions>({
  name: "channelLink",
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
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-id"),
        renderHTML: (attributes) => ({ "data-id": attributes.id }),
      },
      slug: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-slug"),
        renderHTML: (attributes) => ({ "data-slug": attributes.slug }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="channelLink"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "channelLink",
        class:
          "inline-flex items-center rounded px-1 py-0.5 text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200",
      }),
      `#${node.attrs.slug}`,
    ]
  },

  renderText({ node }) {
    return `#${node.attrs.slug}`
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: ChannelPluginKey,
        char: "#",
        allowSpaces: false,
        startOfLine: false,
        ...this.options.suggestion,
        command: ({ editor, range, props }) => {
          const channel = props as ChannelItem

          // Delete the trigger and query, then insert the channel node
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: this.name,
                attrs: {
                  id: channel.id,
                  slug: channel.slug,
                },
              },
              { type: "text", text: " " },
            ])
            .run()
        },
      }),
    ]
  },
})
