import { useCallback, useRef } from "react"

/**
 * Attach a `copy` listener that writes the message's `contentMarkdown` to
 * the clipboard when the user has selected the whole message body.
 *
 * Native browser copy serialises the rendered text — the rendered output
 * intentionally hides or restyles the markdown links that carry the
 * message's structural references (quote-reply `quote:`, shared-message
 * `shared-message:`, attachment `attachment:`), so a select-all + Ctrl+C
 * loses the reference and paste reconstructs as a flat paragraph.
 *
 * The "Copy as Markdown" context-menu action already writes
 * `contentMarkdown` directly, so this hook only intervenes when the
 * selection text matches the body's rendered text — i.e. the user really
 * did select the whole message. Partial selections fall through to the
 * browser default so copying half a sentence still works as expected.
 *
 * Returns a callback ref (so the listener attaches synchronously when the
 * DOM node mounts/unmounts, avoiding the post-mount-attach gap that a plain
 * `useRef` would have).
 */
export function useMessageMarkdownCopy(contentMarkdown: string) {
  const markdownRef = useRef(contentMarkdown)
  markdownRef.current = contentMarkdown
  const cleanupRef = useRef<(() => void) | null>(null)

  return useCallback((node: HTMLDivElement | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    if (!node) return

    const handler = (event: ClipboardEvent) => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      // Bail if the selection escapes the message body — partial cross-message
      // selections are rare and the browser default handles them fine.
      if (!node.contains(range.startContainer) || !node.contains(range.endContainer)) return

      const selectionText = collapseWhitespace(selection.toString())
      if (selectionText.length === 0) return
      const bodyText = collapseWhitespace(node.textContent ?? "")
      if (selectionText !== bodyText) return

      const markdown = markdownRef.current
      if (!markdown) return

      event.clipboardData?.setData("text/plain", markdown)
      event.preventDefault()
    }

    node.addEventListener("copy", handler)
    cleanupRef.current = () => node.removeEventListener("copy", handler)
  }, [])
}

/**
 * Compare-friendly whitespace normalisation. The rendered DOM and the
 * `Selection.toString()` output disagree on how many newlines/spaces sit
 * between block elements, so direct string equality misses obvious
 * "whole message" selections. Collapsing all runs of whitespace to a
 * single space lets us detect the case without rebuilding markdown from
 * the DOM.
 */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}
