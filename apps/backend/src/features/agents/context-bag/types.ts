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
 * Attachment metadata surfaced in the rendered context block. We only carry
 * the fields the model needs to know an attachment exists and what it is —
 * full extractions/page text are loaded on demand through Ariadne's existing
 * attachment tools (`load_attachment`, `load_pdf_section`, etc.) so we don't
 * duplicate the heavy enrichment that runs for the live conversation history.
 *
 * Without this the focal message in a "Discuss with Ariadne" window renders
 * as text-only, which makes the trace lie about what the user attached.
 */
export interface RenderableAttachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
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
  /** Attachments on this source message, if any. Empty/omitted when the message has none. */
  attachments?: RenderableAttachment[]
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
  /**
   * The id of the message the discussion is anchored on (the user clicked
   * "Discuss with Ariadne" on it). The renderer marks this message with a
   * focal-message chevron and splits the inline list around it. Null when
   * the bag has no focal — e.g. `/discuss-with-ariadne` slash command on a
   * whole stream — or when the focal id falls outside the windowed slice.
   */
  focalMessageId: string | null
}

/**
 * Options threaded through to a resolver. The intent drives intent-specific
 * fetch behavior — e.g. DISCUSS_THREAD windows the source stream around the
 * `originMessageId` instead of dumping the whole tail.
 */
export interface ResolverFetchOptions {
  intent: ContextIntent
}

export interface Resolver<TRef extends ContextRef = ContextRef> {
  readonly kind: TRef["kind"]
  canonicalKey(ref: TRef): string
  assertAccess(db: Querier, ref: TRef, userId: string, workspaceId: string): Promise<void>
  fetch(db: Querier, ref: TRef, options?: ResolverFetchOptions): Promise<Omit<ResolvedRef, "ref">>
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
