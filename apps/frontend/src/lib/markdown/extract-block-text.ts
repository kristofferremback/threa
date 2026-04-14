import { Fragment, isValidElement, type ReactNode } from "react"

function flattenInline(children: ReactNode): string {
  if (children === null || children === undefined || typeof children === "boolean") return ""
  if (typeof children === "string") return children
  if (typeof children === "number") return String(children)
  if (Array.isArray(children)) return children.map(flattenInline).join("")
  if (isValidElement(children)) {
    const props = children.props as Record<string, unknown>
    return flattenInline(props.children as ReactNode)
  }
  return ""
}

/**
 * Join top-level block children with newlines so each contributes at least
 * one "line" to line-count estimates. Fragments are transparently unwrapped
 * so fragment-wrapped inputs and react-markdown arrays both work.
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
      const props = node.props as Record<string, unknown>
      if (node.type === Fragment) {
        visit(props.children as ReactNode)
        return
      }
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
 * Counts explicit paragraph breaks plus a wrap estimate for long single lines.
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

export const QUOTE_PREVIEW_LINE_COUNT = 2

export function takeQuotePreview(text: string): string {
  const segments = text.split("\n").filter((segment) => segment.trim().length > 0)
  const picked = segments.slice(0, QUOTE_PREVIEW_LINE_COUNT).join(" ")
  const charCap = APPROX_CHARS_PER_LINE * QUOTE_PREVIEW_LINE_COUNT
  if (picked.length <= charCap) return picked
  return `${picked.slice(0, charCap).trimEnd()}…`
}
