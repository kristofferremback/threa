import { Node, mergeAttributes } from "@tiptap/react"
import Suggestion from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"
import type { Mentionable } from "./types"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"

export const MentionPluginKey = new PluginKey("mention")

export interface MentionNodeAttrs {
  id: string
  slug: string
  mentionType: "user" | "persona" | "broadcast"
}

export interface MentionOptions {
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
 * TipTap extension for @mentions.
 * Creates an inline node that renders as a styled mention chip.
 */
export const MentionExtension = Node.create<MentionOptions>({
  name: "mention",
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
      mentionType: {
        default: "user",
        parseHTML: (element) => element.getAttribute("data-mention-type"),
        renderHTML: (attributes) => ({ "data-mention-type": attributes.mentionType }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const mentionType = node.attrs.mentionType as string
    const baseClass = "inline-flex items-center rounded px-1 py-0.5 text-sm font-medium"
    const typeClasses: Record<string, string> = {
      user: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200",
      persona: "bg-primary/10 text-primary",
      broadcast: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200",
    }

    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "mention",
        class: `${baseClass} ${typeClasses[mentionType] ?? typeClasses.user}`,
      }),
      `@${node.attrs.slug}`,
    ]
  },

  renderText({ node }) {
    return `@${node.attrs.slug}`
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: MentionPluginKey,
        char: "@",
        allowSpaces: false,
        startOfLine: false,
        ...this.options.suggestion,
        command: ({ editor, range, props }) => {
          const mentionable = props as Mentionable

          // Delete the trigger and query, then insert the mention node
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: this.name,
                attrs: {
                  id: mentionable.id,
                  slug: mentionable.slug,
                  mentionType: mentionable.type,
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
