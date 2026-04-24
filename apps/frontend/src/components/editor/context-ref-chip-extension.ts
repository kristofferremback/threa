import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { ContextRefChipView } from "./context-ref-chip-view"

/**
 * Lifecycle status for a composer chip:
 *
 * - `pending` — the client has asked the server to precompute a summary but
 *   the response hasn't landed yet.
 * - `ready`   — precompute returned with a cached summary (large ref).
 * - `inline`  — precompute returned "below threshold, will inline at render";
 *   no summary row was written but the fingerprint is known.
 * - `error`   — precompute failed; `errorMessage` carries detail.
 *
 * `canSend` treats `ready` and `inline` as success; `error` and `pending`
 * keep the send button disabled.
 */
export type ContextRefChipStatus = "pending" | "ready" | "inline" | "error"

export interface ContextRefChipAttrs {
  /** Ref kind — matches server `ContextRefKind`. Only "thread" in v1. */
  refKind: string
  /** Source stream id the ref points at. */
  streamId: string
  /** Optional lower anchor message id; null when the ref covers the full window. */
  fromMessageId: string | null
  /** Optional upper anchor message id. */
  toMessageId: string | null
  /** User-facing label. Computed client-side from the current stream cache. */
  label: string
  /** Precompute lifecycle state. */
  status: ContextRefChipStatus
  /**
   * Fingerprint returned by `POST /context-bag/precompute` once resolution
   * finishes. Null while pending or on error. Carried through to the final
   * `POST /streams` request so the server can skip re-summarizing.
   */
  fingerprint: string | null
  /** Error detail when `status === "error"`. */
  errorMessage: string | null
}

/**
 * Matcher for locating a specific chip in the document. Identity for a
 * context ref is `(refKind, streamId, fromMessageId, toMessageId)` — the
 * same tuple the server uses via `Resolver.canonicalKey` plus anchors.
 */
export interface ContextRefChipIdentity {
  refKind: string
  streamId: string
  fromMessageId: string | null
  toMessageId: string | null
}

function matchesIdentity(attrs: ContextRefChipAttrs, id: ContextRefChipIdentity): boolean {
  return (
    attrs.refKind === id.refKind &&
    attrs.streamId === id.streamId &&
    (attrs.fromMessageId ?? null) === (id.fromMessageId ?? null) &&
    (attrs.toMessageId ?? null) === (id.toMessageId ?? null)
  )
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    contextRefChip: {
      /** Insert a context-ref chip at the current position. */
      insertContextRefChip: (attrs: ContextRefChipAttrs) => ReturnType
      /** Update a chip's attrs by identity tuple (stream + anchors). */
      updateContextRefChip: (identity: ContextRefChipIdentity, updates: Partial<ContextRefChipAttrs>) => ReturnType
    }
  }
}

export const ContextRefChipExtension = Node.create({
  name: "contextRefChip",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,
  marks: "_",

  addAttributes() {
    return {
      refKind: {
        default: "thread",
        parseHTML: (element) => element.getAttribute("data-ref-kind") ?? "thread",
        renderHTML: (attrs) => ({ "data-ref-kind": attrs.refKind }),
      },
      streamId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-stream-id") ?? "",
        renderHTML: (attrs) => ({ "data-stream-id": attrs.streamId }),
      },
      fromMessageId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-from-message-id"),
        renderHTML: (attrs) => (attrs.fromMessageId ? { "data-from-message-id": attrs.fromMessageId } : {}),
      },
      toMessageId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-to-message-id"),
        renderHTML: (attrs) => (attrs.toMessageId ? { "data-to-message-id": attrs.toMessageId } : {}),
      },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") ?? "",
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
      status: {
        default: "pending" as ContextRefChipStatus,
        parseHTML: (element) => (element.getAttribute("data-status") as ContextRefChipStatus) ?? "pending",
        renderHTML: (attrs) => ({ "data-status": attrs.status }),
      },
      fingerprint: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-fingerprint"),
        renderHTML: (attrs) => (attrs.fingerprint ? { "data-fingerprint": attrs.fingerprint } : {}),
      },
      errorMessage: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-error-message"),
        renderHTML: (attrs) => (attrs.errorMessage ? { "data-error-message": attrs.errorMessage } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="context-ref-chip"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // Atom nodes have no content hole — using `0` breaks `editor.getHTML()`
    // with "Content hole not allowed in a leaf node spec".
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "context-ref-chip" })]
  },

  // Copy/paste out of the editor: prefer the label over an empty square bracket.
  renderText({ node }) {
    const attrs = node.attrs as ContextRefChipAttrs
    return attrs.label ? `[${attrs.label}]` : `[Context]`
  },

  addNodeView() {
    return ReactNodeViewRenderer(ContextRefChipView)
  },

  addCommands() {
    return {
      insertContextRefChip:
        (attrs) =>
        ({ chain, state }) => {
          // Preserve active marks at the cursor so the chip inherits any
          // bold/italic styling just like AttachmentReferenceExtension does.
          const { $from } = state.selection
          const { storedMarks } = state
          const currentMarks = storedMarks || $from.marks()
          const marks = currentMarks.map((mark: { type: { name: string }; attrs: Record<string, unknown> }) => ({
            type: mark.type.name,
            attrs: mark.attrs,
          }))

          return chain()
            .insertContent([
              { type: "contextRefChip", attrs, marks },
              { type: "text", text: " ", marks },
            ])
            .run()
        },

      updateContextRefChip:
        (identity, updates) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          let found = false
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "contextRefChip") return true
            const attrs = node.attrs as ContextRefChipAttrs
            if (!matchesIdentity(attrs, identity)) return true
            tr.setNodeMarkup(pos, undefined, { ...attrs, ...updates })
            found = true
            return false
          })

          if (found) {
            dispatch(tr)
            return true
          }
          return false
        },
    }
  },
})
