import { Node, mergeAttributes } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { QuoteReplyView } from "./quote-reply-view"

export interface QuoteReplyAttrs {
  /** The ID of the quoted message */
  messageId: string
  /** The stream containing the quoted message */
  streamId: string
  /** Display name of the quoted message author (denormalized) */
  authorName: string
  /** The ID of the quoted message author */
  authorId: string
  /** The actor type of the quoted message author */
  actorType: string
  /** The quoted text snippet */
  snippet: string
}

export const QuoteReplyExtension = Node.create({
  name: "quoteReply",
  group: "block",
  selectable: true,
  draggable: false,
  atom: true,

  addAttributes() {
    return {
      messageId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-message-id"),
        renderHTML: (attrs) => ({ "data-message-id": attrs.messageId }),
      },
      streamId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-stream-id"),
        renderHTML: (attrs) => ({ "data-stream-id": attrs.streamId }),
      },
      authorName: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-author-name"),
        renderHTML: (attrs) => ({ "data-author-name": attrs.authorName }),
      },
      authorId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-author-id"),
        renderHTML: (attrs) => ({ "data-author-id": attrs.authorId }),
      },
      actorType: {
        default: "user",
        parseHTML: (element) => element.getAttribute("data-actor-type"),
        renderHTML: (attrs) => ({ "data-actor-type": attrs.actorType }),
      },
      snippet: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-snippet"),
        renderHTML: (attrs) => ({ "data-snippet": attrs.snippet }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="quote-reply"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "quote-reply" })]
  },

  renderText({ node }) {
    const attrs = node.attrs as QuoteReplyAttrs
    return `> ${attrs.snippet}\n> — ${attrs.authorName}\n`
  },

  addNodeView() {
    return ReactNodeViewRenderer(QuoteReplyView)
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("quoteReplyParagraphGuard"),
        appendTransaction: (_transactions, _oldState, newState) => {
          const { doc, schema, tr } = newState
          const insertions: number[] = []

          doc.forEach((node, pos, index) => {
            if (node.type.name !== "quoteReply") return

            // Need a paragraph before if this is the first node or preceded by another quoteReply
            const prev = index > 0 ? doc.child(index - 1) : null
            if (!prev || prev.type.name === "quoteReply") {
              insertions.push(pos)
            }

            // Need a paragraph after if this is the last node
            if (index === doc.childCount - 1) {
              insertions.push(pos + node.nodeSize)
            }
          })

          if (insertions.length === 0) return null

          // Insert in reverse order so positions stay valid
          for (let i = insertions.length - 1; i >= 0; i--) {
            tr.insert(insertions[i], schema.nodes.paragraph.create())
          }

          return tr
        },
      }),
    ]
  },
})
