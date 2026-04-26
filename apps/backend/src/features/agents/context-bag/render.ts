import type { LastRenderedSnapshot, RenderableMessage, SummaryInput } from "./types"
import type { DiffResult } from "./diff"

export interface StableRenderInput {
  preamble: string
  /** When present, the stable body is rendered inline (small-thread case). */
  inlineItems?: RenderableMessage[]
  /** When present, the stable body is the cached summary (large-thread case). */
  summaryText?: string
  refLabel: string
}

/**
 * Build the stable region of the prompt. This region MUST stay byte-identical
 * across turns for already-rendered content so the Anthropic prompt-cache
 * prefix survives — do not mutate here based on later edits/deletes; those go
 * in the volatile delta region instead.
 */
export function renderStable(input: StableRenderInput): string {
  const parts: string[] = [input.preamble.trim(), "", `## Context source: ${input.refLabel}`]

  if (input.summaryText) {
    parts.push("", "Summary (cached):", input.summaryText.trim())
  } else if (input.inlineItems && input.inlineItems.length > 0) {
    parts.push("", "Messages (chronological):")
    for (const item of input.inlineItems) {
      parts.push(formatInlineMessage(item))
    }
  } else {
    parts.push("", "(no messages in source thread yet)")
  }

  return parts.join("\n")
}

function formatInlineMessage(item: RenderableMessage): string {
  const ts = item.createdAt
  const edited = item.editedAt ? ` (edited ${item.editedAt})` : ""
  return `- [${item.messageId}] ${item.authorName} at ${ts}${edited}:\n  ${item.contentMarkdown.replaceAll("\n", "\n  ")}`
}

export interface DeltaRenderInput {
  diff: DiffResult
  /**
   * Lookup for current renderable content, keyed by messageId. Edits/appends
   * pull `contentMarkdown` from here; deletes use `previous.contentFingerprint`
   * only (we don't retain the deleted text and honestly signalling "deleted"
   * is enough for Ariadne to reason about the change).
   */
  currentByMessageId: Map<string, RenderableMessage>
}

/**
 * Build the volatile "since last turn" section. Returns an empty string when
 * there is no drift so callers can conditionally include the whole block.
 */
export function renderDelta(input: DeltaRenderInput): string {
  const { diff, currentByMessageId } = input
  if (diff.appends.length === 0 && diff.edits.length === 0 && diff.deletes.length === 0) {
    return ""
  }

  const lines: string[] = ["## Since last turn"]

  if (diff.appends.length > 0) {
    lines.push("", "Appended messages:")
    for (const append of diff.appends) {
      const current = currentByMessageId.get(append.messageId)
      if (!current) continue
      lines.push(formatInlineMessage(current))
    }
  }

  if (diff.edits.length > 0) {
    lines.push("", "Edited messages (treat as authoritative over the main context body):")
    for (const edit of diff.edits) {
      const current = currentByMessageId.get(edit.current.messageId)
      if (!current) continue
      lines.push(
        `- [${edit.current.messageId}] now reads:`,
        `  ${current.contentMarkdown.replaceAll("\n", "\n  ")}`,
        `  (previous fingerprint ${edit.previous.contentFingerprint.slice(0, 12)})`
      )
    }
  }

  if (diff.deletes.length > 0) {
    lines.push("", "Deleted messages:")
    for (const del of diff.deletes) {
      lines.push(`- [${del.messageId}] deleted (previous fingerprint ${del.contentFingerprint.slice(0, 12)})`)
    }
  }

  return lines.join("\n")
}

export function buildSnapshot(inputs: SummaryInput[], tailMessageId: string | null): LastRenderedSnapshot {
  return {
    renderedAt: new Date().toISOString(),
    items: inputs,
    tailMessageId,
  }
}
