import { Node, mergeAttributes } from "@tiptap/core"
import { GapCursor } from "@tiptap/pm/gapcursor"
import { Selection } from "@tiptap/pm/state"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { QuoteReplyView } from "./quote-reply-view"

function insertParagraphAtGapCursor(editor: {
  state: import("@tiptap/pm/state").EditorState
  view: import("@tiptap/pm/view").EditorView
}): boolean {
  const { state } = editor
  if (!(state.selection instanceof GapCursor)) return false

  const pos = state.selection.$from.pos
  const paragraph = state.schema.nodes.paragraph.create()
  const tr = state.tr.insert(pos, paragraph)
  tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)))
  editor.view.dispatch(tr)
  return true
}

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

  addKeyboardShortcuts() {
    return {
      Enter: () => insertParagraphAtGapCursor(this.editor),
      "Shift-Enter": () => insertParagraphAtGapCursor(this.editor),
    }
  },
})
