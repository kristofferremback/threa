import type { SharedMessageAttrs } from "@/components/editor/shared-message-extension"

/**
 * Ephemeral per-stream "hand-off" of a share node from the Share action
 * (anywhere in the app) to the target stream's composer. The composer reads
 * and clears the entry on mount, inserts the node, and the user sends via
 * the normal send button.
 *
 * Scoped to a single navigation hop with a short TTL so stale entries never
 * resurface if the user bails mid-flow.
 */
export interface ShareHandoffEntry {
  /** Attrs for the ThreaSharedMessage node to insert at the top of the composer */
  attrs: SharedMessageAttrs
  /** Epoch ms expiration; entries past this are ignored + evicted on read */
  expiresAt: number
}

const HANDOFF_TTL_MS = 5 * 60 * 1000

const cache = new Map<string, ShareHandoffEntry>()

/**
 * Queue a share node for the target stream's composer. The next composer
 * mount for that stream consumes and clears the entry.
 */
export function queueShareHandoff(targetStreamId: string, attrs: SharedMessageAttrs): void {
  cache.set(targetStreamId, {
    attrs,
    expiresAt: Date.now() + HANDOFF_TTL_MS,
  })
}

/**
 * Read + clear the pending share for the given stream. Returns null when
 * nothing is queued or the entry has expired (and evicts it).
 */
export function consumeShareHandoff(targetStreamId: string): SharedMessageAttrs | null {
  const entry = cache.get(targetStreamId)
  if (!entry) return null
  cache.delete(targetStreamId)
  if (entry.expiresAt < Date.now()) return null
  return entry.attrs
}

/**
 * Non-consuming peek. Returns whether a share is currently queued for the
 * stream. Mostly for tests and debug panels.
 */
export function peekShareHandoff(targetStreamId: string): SharedMessageAttrs | null {
  const entry = cache.get(targetStreamId)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    cache.delete(targetStreamId)
    return null
  }
  return entry.attrs
}

/** Clears every queued handoff. Test helper; not used in production code. */
export function __resetShareHandoffStoreForTesting(): void {
  cache.clear()
}
