import { ReactRenderer } from "@tiptap/react"
import tippy, { type Instance as TippyInstance } from "tippy.js"
import { MentionList, type MentionListRef, type MentionItem } from "./MentionList"
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion"

export type MentionType = "user" | "channel" | "crosspost"

export interface MentionSuggestionOptions {
  users: Array<{ id: string; name: string; email: string }>
  channels: Array<{ id: string; name: string; slug: string | null }>
}

// Fuzzy search helper
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()

  // Direct substring match
  if (t.includes(q)) return true

  // Fuzzy match - all query chars must appear in order
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

export function createUserSuggestion(options: MentionSuggestionOptions): Partial<SuggestionOptions<MentionItem>> {
  return {
    char: "@",
    allowSpaces: false,
    items: ({ query }): MentionItem[] => {
      const q = query.toLowerCase()
      return options.users
        .filter((user) => {
          if (!q) return true
          return fuzzyMatch(q, user.name) || fuzzyMatch(q, user.email)
        })
        .slice(0, 8)
        .map((user) => ({
          id: user.id,
          label: user.name,
          type: "user" as const,
          email: user.email,
          name: user.name,
        }))
    },
    // Custom command to pass all attributes
    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          {
            type: "userMention",
            attrs: {
              id: props.id,
              label: props.label,
            },
          },
          { type: "text", text: " " },
        ])
        .run()
    },
    render: () => {
      let component: ReactRenderer<MentionListRef> | null = null
      let popup: TippyInstance[] | null = null

      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          })

          if (!props.clientRect) return

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
            theme: "mention",
            offset: [0, 8],
          })
        },

        onUpdate: (props: SuggestionProps<MentionItem>) => {
          component?.updateProps(props)

          if (!props.clientRect) return

          popup?.[0]?.setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          })
        },

        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide()
            return true
          }

          return component?.ref?.onKeyDown(props) ?? false
        },

        onExit: () => {
          popup?.[0]?.destroy()
          component?.destroy()
        },
      }
    },
  }
}

export function createChannelSuggestion(options: MentionSuggestionOptions): Partial<SuggestionOptions<MentionItem>> {
  return {
    char: "#",
    allowSpaces: false,
    items: ({ query }): MentionItem[] => {
      const q = query.toLowerCase()

      // Check if this is a crosspost (#+)
      const isCrosspost = q.startsWith("+")
      const searchQuery = isCrosspost ? q.slice(1) : q

      return options.channels
        .filter((channel) => {
          // For crossposts, only show channels with slugs (no DMs)
          if (isCrosspost && !channel.slug) return false

          if (!searchQuery) return true
          return fuzzyMatch(searchQuery, channel.name) || fuzzyMatch(searchQuery, channel.slug || "")
        })
        .slice(0, 8)
        .map((channel) => ({
          id: channel.id,
          label: channel.name,
          type: isCrosspost ? ("crosspost" as const) : ("channel" as const),
          slug: channel.slug,
        }))
    },
    // Custom command to pass all attributes including slug and type
    command: ({ editor, range, props }) => {
      // Delete the trigger and query text, then insert the mention node
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          {
            type: "channelMention",
            attrs: {
              id: props.id,
              label: props.label,
              type: props.type,
              slug: props.slug,
            },
          },
          { type: "text", text: " " }, // Add space after mention
        ])
        .run()
    },
    render: () => {
      let component: ReactRenderer<MentionListRef> | null = null
      let popup: TippyInstance[] | null = null

      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          })

          if (!props.clientRect) return

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
            theme: "mention",
            offset: [0, 8],
          })
        },

        onUpdate: (props: SuggestionProps<MentionItem>) => {
          component?.updateProps(props)

          if (!props.clientRect) return

          popup?.[0]?.setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          })
        },

        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide()
            return true
          }

          return component?.ref?.onKeyDown(props) ?? false
        },

        onExit: () => {
          popup?.[0]?.destroy()
          component?.destroy()
        },
      }
    },
  }
}
