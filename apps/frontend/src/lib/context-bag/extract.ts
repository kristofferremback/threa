import type { JSONContent } from "@tiptap/core"
import type { ContextBag, ContextIntent, ContextRef } from "@threa/types"
import { ContextRefKinds } from "@threa/types"
import type { ContextRefChipAttrs } from "@/components/editor/context-ref-chip-extension"

/**
 * Walk a composer document and collect every `contextRefChip` node's attrs.
 * Duplicate-free by the (kind, streamId, fromMessageId, toMessageId) identity
 * tuple — copy-pasting the same chip twice in the composer contributes one
 * ref, not two. Preserves first-seen order.
 */
export function collectContextRefChips(doc: JSONContent | null | undefined): ContextRefChipAttrs[] {
  if (!doc) return []

  const seen = new Set<string>()
  const out: ContextRefChipAttrs[] = []

  function visit(node: JSONContent) {
    if (node.type === "contextRefChip") {
      const attrs = node.attrs as ContextRefChipAttrs | undefined
      if (attrs) {
        const key = identityKey(attrs)
        if (!seen.has(key)) {
          seen.add(key)
          out.push(attrs)
        }
      }
      return
    }
    if (node.content) {
      for (const child of node.content) visit(child)
    }
  }

  visit(doc)
  return out
}

function identityKey(attrs: ContextRefChipAttrs): string {
  return [attrs.refKind, attrs.streamId, attrs.fromMessageId ?? "", attrs.toMessageId ?? ""].join("|")
}

/**
 * Extract a `ContextBag` payload from composer content for submission. Returns
 * null when the doc has no chips — callers send a bag only when one is present.
 *
 * `intent` is supplied by the caller because today it's uniform per composer
 * draft (v1 only has `discuss-thread`). If multiple intents ever need to
 * coexist in one composer we'd switch to per-chip intents.
 *
 * Chips in non-ready states (`pending` / `error`) are still returned here —
 * the send gate (`canSendContextBag`) is responsible for blocking send in
 * those cases so we don't need to silently drop refs from the payload.
 */
export function extractContextBagFromContent(
  doc: JSONContent | null | undefined,
  intent: ContextIntent
): ContextBag | null {
  const chips = collectContextRefChips(doc)
  if (chips.length === 0) return null

  const refs: ContextRef[] = chips.map((attrs) => ({
    kind: ContextRefKinds.THREAD,
    streamId: attrs.streamId,
    ...(attrs.fromMessageId ? { fromMessageId: attrs.fromMessageId } : {}),
    ...(attrs.toMessageId ? { toMessageId: attrs.toMessageId } : {}),
  }))

  return { intent, refs }
}

/**
 * True iff every chip is in a sendable state (`ready` or `inline`). Drives
 * `composer.canSend`: a chip that's still pending or that errored during
 * precompute must block submission, same as an in-flight upload does.
 */
export function canSendContextBag(doc: JSONContent | null | undefined): boolean {
  const chips = collectContextRefChips(doc)
  return chips.every((c) => c.status === "ready" || c.status === "inline")
}

/**
 * True iff any chip is currently in a pending state. Used by the composer
 * UI to show a subtle "preparing context…" affordance distinct from errors.
 */
export function hasPendingContextRefs(doc: JSONContent | null | undefined): boolean {
  return collectContextRefChips(doc).some((c) => c.status === "pending")
}
