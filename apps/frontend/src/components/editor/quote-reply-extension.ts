import { Node, mergeAttributes } from "@tiptap/core"
import { TextSelection } from "@tiptap/pm/state"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { QuoteReplyView } from "./quote-reply-view"

export interface QuoteReplyAttrs {
  /** The ID of the quoted message */
  messageId: string
  /** The stream containing the quoted message */
  streamId: string
  /** Display name of the quoted message author (denormalized) */
  authorName: string
  /** The quoted text snippet */
  snippet: string
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    quoteReply: {
      /** Insert a quote reply block at the start of the document */
      insertQuoteReply: (attrs: QuoteReplyAttrs) => ReturnType
    }
  }
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

  addCommands() {
    return {
      insertQuoteReply:
        (attrs) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          const quoteNode = state.schema.nodes.quoteReply.create(attrs)

          // Replace any existing quoteReply at position 0, or insert at top
          let existingQuoteEnd = 0
          if (doc.firstChild?.type.name === "quoteReply") {
            existingQuoteEnd = doc.firstChild.nodeSize
          }

          tr.replaceWith(0, existingQuoteEnd, quoteNode)
          // Move cursor to after the quote reply
          const resolvedPos = tr.doc.resolve(quoteNode.nodeSize)
          tr.setSelection(TextSelection.near(resolvedPos))
          dispatch(tr)
          return true
        },
    }
  },
})
