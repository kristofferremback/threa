import type { Querier } from "../../../db"
import type { Pool } from "pg"
import { withClient } from "../../../db"
import type { AI, CostContext } from "../../../lib/ai/ai"
import { logger } from "../../../lib/logger"
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
  /** Snapshot the caller must persist in the SAME transaction as the agent reply (INV-7). */
  nextSnapshot: LastRenderedSnapshot
}

export interface ResolveBagDeps {
  pool: Pool
  ai: AI
  costContext: CostContext
}

/**
 * Resolve the bag attached to a stream (if any), producing a cache-friendly
 * prompt region pair (stable + delta) plus the `nextSnapshot` the caller
 * should persist in the same transaction as the agent's reply.
 *
 * INV-41: we acquire and release the DB connection before kicking off the
 * (potentially slow) summarization AI call. If summarization is needed, we
 * write the resulting summary back through a fresh short-lived connection.
 */
export async function resolveBagForStream(deps: ResolveBagDeps, streamId: string): Promise<ResolvedBag | null> {
  const { pool, ai, costContext } = deps

  // Phase 1 (DB): load the bag, resolve its refs, compute diff + inputs.
  const phase1 = await withClient(pool, async (db) => {
    const bag = await ContextBagRepository.findByStream(db, streamId)
    if (!bag) return null

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

  if (!phase1) return null

  const { bag, config, resolveds } = phase1

  // Phase 2 (maybe AI): for each ref, decide inline vs summary. Summaries use
  // the shared cache keyed by (workspace, refKind, refKey, fingerprint).
  const stableParts: string[] = []
  const deltaParts: string[] = []
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

    nextItems.push(...resolved.inputs)
    if (resolved.tailMessageId) nextTail = resolved.tailMessageId
  }

  return {
    bagId: bag.id,
    intent: bag.intent,
    stable: stableParts.join("\n\n"),
    delta: deltaParts.join("\n\n"),
    nextSnapshot: buildSnapshot(nextItems, nextTail),
  }
}

async function loadOrCreateSummary(params: {
  pool: Pool
  ai: AI
  costContext: CostContext
  workspaceId: string
  refKind: string
  refKey: string
  fingerprint: string
  inputs: SummaryInput[]
  items: RenderableMessage[]
}): Promise<string> {
  const { pool, ai, costContext, workspaceId, refKind, refKey, fingerprint, inputs, items } = params

  // Access check happens at the assertAccess boundary in the caller. Here we
  // only care about cache lookup + write, so a short single-query connection
  // is fine (INV-30). The AI call runs without holding any DB connection
  // (INV-41), then we write the result back through a fresh connection.
  const cached = await SummaryRepository.find(pool, { workspaceId, refKind: refKind as "thread", refKey, fingerprint })
  if (cached) return cached.summaryText

  const { text, model } = await summarizeThread({ ai, costContext }, { refKey, items })

  await SummaryRepository.upsert(pool, {
    workspaceId,
    refKind: refKind as "thread",
    refKey,
    fingerprint,
    inputs,
    summaryText: text,
    model,
  })

  return text
}

/**
 * Persist the snapshot from a successful render. Callers should invoke this
 * in the same transaction as the agent's reply write (INV-7).
 */
export async function persistSnapshot(db: Querier, bagId: string, snapshot: LastRenderedSnapshot): Promise<void> {
  await ContextBagRepository.updateLastRendered(db, bagId, snapshot)
}
