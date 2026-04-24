import type { Querier } from "../../../db"
import type { Pool } from "pg"
import { withClient } from "../../../db"
import type { AI, CostContext } from "../../../lib/ai/ai"
import { logger } from "../../../lib/logger"
import type { ContextRefKind } from "@threa/types"
import { ContextBagRepository } from "./repository"
import { SummaryRepository } from "./summary-repository"
import { getIntentConfig, getResolver } from "./registry"
import { diffInputs } from "./diff"
import { buildSnapshot, renderDelta, renderStable } from "./render"
import { summarizeThread } from "./summarizer"
import type { LastRenderedSnapshot, RenderableMessage, ResolvedRef, StoredContextBag, SummaryInput } from "./types"

export interface ResolvedBag {
  bagId: string
  intent: StoredContextBag["intent"]
  /** Rendered prompt region that SHOULD stay byte-identical across turns for a stable cache prefix. */
  stable: string
  /** Rendered "since last turn" region. Empty string when there's no drift. */
  delta: string
  /**
   * Renderable items from every resolved ref, concatenated in ref order. Used
   * by callers that want to surface the raw messages behind the bag (e.g. the
   * agent-session trace `context_received` step) regardless of whether the
   * stable region inlined them or collapsed them into a summary.
   */
  items: RenderableMessage[]
  /**
   * Snapshot the caller should persist after the agent turn completes. This
   * is NOT co-committed with the message insert — see `persistSnapshot` for
   * the crash-window safety model (session COMPLETED guard + `clientMessageId`
   * dedup + idempotent UPDATE).
   */
  nextSnapshot: LastRenderedSnapshot
}

export interface ResolveBagDeps {
  pool: Pool
  ai: AI
  costContext: CostContext
}

export interface ResolveBagOptions {
  /**
   * When true, return null if the bag's `lastRendered` is already non-null.
   * Used by the pre-compute worker so a retried job skips the resolver +
   * summarization pass once the initial snapshot has been written.
   */
  skipIfAlreadyRendered?: boolean
}

/**
 * Resolve the bag attached to a stream (if any), producing a cache-friendly
 * prompt region pair (stable + delta) plus the `nextSnapshot` the caller
 * should persist after the AI turn.
 *
 * INV-41: we acquire and release the DB connection before kicking off the
 * (potentially slow) summarization AI call. If summarization is needed, we
 * write the resulting summary back through a fresh short-lived connection.
 */
export async function resolveBagForStream(
  deps: ResolveBagDeps,
  streamId: string,
  options?: ResolveBagOptions
): Promise<ResolvedBag | null> {
  const { pool, ai, costContext } = deps

  // Phase 1 (DB): load the bag, resolve its refs, compute diff + inputs.
  const phase1 = await withClient(pool, async (db) => {
    const bag = await ContextBagRepository.findByStream(db, streamId)
    if (!bag) return null

    // Short-circuit for idempotent callers (pre-compute worker): if the bag
    // has already been rendered once, don't waste a resolver pass or a
    // summarization AI call — the caller will skip its downstream work.
    if (options?.skipIfAlreadyRendered && bag.lastRendered !== null) {
      return "already-rendered" as const
    }

    const config = getIntentConfig(bag.intent)
    const resolveds: ResolvedRef[] = []
    for (const ref of bag.refs) {
      if (!config.supportedKinds.includes(ref.kind)) {
        logger.warn({ intent: bag.intent, kind: ref.kind }, "context-bag: unsupported ref kind for intent, skipping")
        continue
      }
      const resolver = getResolver(ref.kind)
      const part = await resolver.fetch(db, ref)
      resolveds.push({ ref, ...part })
    }

    return { bag, config, resolveds }
  })

  if (!phase1 || phase1 === "already-rendered") return null

  const { bag, config, resolveds } = phase1

  // Phase 2 (maybe AI): for each ref, decide inline vs summary. Summaries use
  // the shared cache keyed by (workspace, refKind, refKey, fingerprint).
  const stableParts: string[] = []
  const deltaParts: string[] = []
  const allItems: RenderableMessage[] = []
  const nextItems: SummaryInput[] = []
  let nextTail: string | null = null

  for (const resolved of resolveds) {
    const inlineSize = resolved.items.reduce((acc, m) => acc + m.contentMarkdown.length, 0)
    const resolver = getResolver(resolved.ref.kind)
    const refKey = resolver.canonicalKey(resolved.ref)

    let summaryText: string | undefined
    if (inlineSize > config.inlineCharThreshold && resolved.items.length > 0) {
      summaryText = await loadOrCreateSummary({
        pool,
        ai,
        costContext,
        workspaceId: bag.workspaceId,
        refKind: resolved.ref.kind,
        refKey,
        fingerprint: resolved.fingerprint,
        inputs: resolved.inputs,
        items: resolved.items,
      })
    }

    const stable = renderStable({
      preamble: config.systemPreamble,
      inlineItems: summaryText ? undefined : resolved.items,
      summaryText,
      refLabel: refKey,
    })
    stableParts.push(stable)

    const diff = diffInputs(resolved.inputs, bag.lastRendered)
    const currentByMessageId = new Map<string, RenderableMessage>(resolved.items.map((item) => [item.messageId, item]))
    const delta = renderDelta({ diff, currentByMessageId })
    if (delta) deltaParts.push(delta)

    allItems.push(...resolved.items)
    nextItems.push(...resolved.inputs)
    if (resolved.tailMessageId) nextTail = resolved.tailMessageId
  }

  return {
    bagId: bag.id,
    intent: bag.intent,
    stable: stableParts.join("\n\n"),
    delta: deltaParts.join("\n\n"),
    items: allItems,
    nextSnapshot: buildSnapshot(nextItems, nextTail),
  }
}

/**
 * Look up a cached summary for a resolved ref, or produce one and upsert.
 * Exported so the standalone precompute service can reuse the exact same
 * cache logic as the stream-attached resolver path (INV-35). INV-41: the AI
 * call runs without holding a DB connection.
 */
export async function loadOrCreateSummary(params: {
  pool: Pool
  ai: AI
  costContext: CostContext
  workspaceId: string
  refKind: ContextRefKind
  refKey: string
  fingerprint: string
  inputs: SummaryInput[]
  items: RenderableMessage[]
}): Promise<string> {
  const { pool, ai, costContext, workspaceId, refKind, refKey, fingerprint, inputs, items } = params

  const cached = await SummaryRepository.find(pool, { workspaceId, refKind, refKey, fingerprint })
  if (cached) return cached.summaryText

  const { text, model } = await summarizeThread({ ai, costContext }, { refKey, items })

  const stored = await SummaryRepository.upsert(pool, {
    workspaceId,
    refKind,
    refKey,
    fingerprint,
    inputs,
    summaryText: text,
    model,
  })
  return stored.summaryText
}

/**
 * Persist the snapshot from a successful render.
 *
 * Idempotent standalone UPDATE — callers run it as the final step of a render
 * pass. The pre-compute worker writes this after `resolveBagForStream`
 * finishes; retries short-circuit via `skipIfAlreadyRendered` rather than
 * re-writing the same snapshot. See `context-bag-precompute-handler.ts`.
 */
export async function persistSnapshot(db: Querier, bagId: string, snapshot: LastRenderedSnapshot): Promise<void> {
  await ContextBagRepository.updateLastRendered(db, bagId, snapshot)
}
