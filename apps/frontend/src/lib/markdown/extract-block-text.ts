import { Fragment, isValidElement, type ReactNode } from "react"

/**
 * Flatten an inline ReactNode subtree to a plain text string.
 * Used as the "leaf" reader for per-paragraph extraction.
 */
function flattenInline(children: ReactNode): string {
  if (children === null || children === undefined || typeof children === "boolean") return ""
  if (typeof children === "string") return children
  if (typeof children === "number") return String(children)
  if (Array.isArray(children)) return children.map(flattenInline).join("")
  if (isValidElement(children)) {
    const props = children.props as Record<string, unknown>
    if (children.type === Fragment) {
      return flattenInline(props.children as ReactNode)
    }
    return flattenInline(props.children as ReactNode)
  }
  return ""
}

/**
 * Extract plain text from a ReactNode subtree, joining top-level block children
 * (paragraphs, lists, …) with newlines so each contributes at least one "line"
 * to line-count estimates. React fragments are transparently unwrapped so
 * fragment-wrapped inputs and react-markdown arrays both work.
 *
 * Used by collapsible blockquotes and quote replies to measure quoted content.
 */
export function extractBlockText(children: ReactNode): string {
  const parts: string[] = []
  const visit = (node: ReactNode) => {
    if (node === null || node === undefined || typeof node === "boolean") return
    if (typeof node === "string") {
      parts.push(node)
      return
    }
    if (typeof node === "number") {
      parts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (isValidElement(node)) {
      if (node.type === Fragment) {
        const props = node.props as Record<string, unknown>
        visit(props.children as ReactNode)
        return
      }
      const props = node.props as Record<string, unknown>
      parts.push(flattenInline(props.children as ReactNode))
    }
  }
  visit(children)
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n")
}

/** Approximate visual characters per wrapped line for line-count estimation. */
const APPROX_CHARS_PER_LINE = 80

/**
 * Estimate how many visual lines a quoted block will occupy.
 * Counts explicit paragraph breaks plus wrapping for long single lines.
 * Not pixel-perfect — good enough to decide whether a quote is "long".
 */
export function estimateBlockLines(text: string): number {
  if (text.length === 0) return 0
  const segments = text.split("\n")
  let total = 0
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (trimmed.length === 0) continue
    total += Math.max(1, Math.ceil(trimmed.length / APPROX_CHARS_PER_LINE))
  }
  return Math.max(1, total)
}

/** Number of leading visual lines shown as a preview for a collapsed quote. */
export const QUOTE_PREVIEW_LINE_COUNT = 2

/**
 * Pick a short leading preview of a quoted block for the collapsed view.
 * Truncates to `QUOTE_PREVIEW_LINE_COUNT` wrapped lines, appending an ellipsis
 * when the content exceeds that window.
 */
export function takeQuotePreview(text: string): string {
  const segments = text.split("\n").filter((segment) => segment.trim().length > 0)
  const picked = segments.slice(0, QUOTE_PREVIEW_LINE_COUNT).join(" ")
  const charCap = APPROX_CHARS_PER_LINE * QUOTE_PREVIEW_LINE_COUNT
  if (picked.length <= charCap) return picked
  return `${picked.slice(0, charCap).trimEnd()}…`
}
