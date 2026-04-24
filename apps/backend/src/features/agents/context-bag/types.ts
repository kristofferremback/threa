import type { ContextBag, ContextIntent, ContextRef, ContextRefKind } from "@threa/types"
import type { Querier } from "../../../db"
import type { AI, CostContext } from "../../../lib/ai/ai"

/**
 * Persisted bag row (before resolution). `lastRendered` is the snapshot
 * written after the previous turn completed.
 */
export interface StoredContextBag extends ContextBag {
  id: string
  workspaceId: string
  streamId: string
  createdBy: string
  lastRendered: LastRenderedSnapshot | null
  createdAt: Date
  updatedAt: Date
}

/**
 * One entry in the summary inputs manifest. A change to any field across turns
 * flips the fingerprint and causes a cache miss.
 */
export interface SummaryInput {
  messageId: string
  contentFingerprint: string
  editedAt: string | null
  deleted: boolean
}

/**
 * Snapshot written after each successful render so the next turn can diff and
 * narrate appends/edits/deletes.
 */
export interface LastRenderedSnapshot {
  renderedAt: string
  items: SummaryInput[]
  tailMessageId: string | null
}

/**
 * Minimal renderable unit for the thread resolver. Kept narrow so the resolver
 * doesn't leak the full Message shape into the render step.
 */
export interface RenderableMessage {
  messageId: string
  authorId: string
  authorName: string
  contentMarkdown: string
  createdAt: string
  editedAt: string | null
  sequence: bigint
}

/**
 * What a resolver returns after fetching the ref's current state.
 */
export interface ResolvedRef {
  ref: ContextRef
  items: RenderableMessage[]
  inputs: SummaryInput[]
  /** SHA-256 over the canonical `inputs` manifest. */
  fingerprint: string
  tailMessageId: string | null
}

export interface Resolver<TRef extends ContextRef = ContextRef> {
  readonly kind: TRef["kind"]
  canonicalKey(ref: TRef): string
  assertAccess(db: Querier, ref: TRef, userId: string, workspaceId: string): Promise<void>
  fetch(db: Querier, ref: TRef): Promise<Omit<ResolvedRef, "ref">>
}

/**
 * Per-intent config: prompt fragments + per-kind sizing. The intent drives the
 * inline-vs-summarize decision and the system preamble.
 */
export interface IntentConfig {
  intent: ContextIntent
  /** Soft threshold for inline rendering (characters of combined markdown). */
  inlineCharThreshold: number
  /** Instruction preamble prepended to the stable region. */
  systemPreamble: string
  /** Supported ref kinds for this intent. */
  supportedKinds: readonly ContextRefKind[]
}

export interface SummarizerDeps {
  ai: AI
  /** Workspace id + optional userId for cost attribution. */
  costContext: CostContext
}
