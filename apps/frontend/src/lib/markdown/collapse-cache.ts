import { useSyncExternalStore } from "react"
import { db } from "@/db"
import type { MarkdownBlockKind } from "./markdown-block-context"

/**
 * Synchronous in-memory mirror of the `markdownBlockCollapse` and
 * `linkPreviewCollapse` IDB tables. Loaded once on app boot via
 * `hydrateCollapseCache()` and consumed by `useBlockCollapse` /
 * `useLinkPreviewCollapse` through `useSyncExternalStore`.
 *
 * Why: those hooks previously read via `useLiveQuery`, which returns
 * `undefined` synchronously and resolves the persisted value on a later
 * microtask. Inside a Virtuoso list that causes every persistently-toggled
 * code block, blockquote, or link-preview card to flip size *after* the
 * timeline has already painted, which Virtuoso compensates for by shifting
 * sibling rows — the visible "jumping" on stream load. Bulk-loading once
 * before the timeline mounts lets the first paint reflect the user's
 * persisted choices, so no resize cascade occurs.
 *
 * Cross-tab note: this cache does not subscribe to Dexie's change feed, so
 * toggling collapse state in tab A no longer propagates to tab B without a
 * reload. That's an intentional trade — collapse state is a per-tab UX
 * preference, and the live-query subscription is what made the first paint
 * unstable in the first place.
 */

const blockCollapse = new Map<string, boolean>()
const linkPreviewExpand = new Map<string, boolean>()

const blockListeners = new Set<() => void>()
const linkPreviewListeners = new Set<() => void>()

let hydrated = false
let hydrationPromise: Promise<void> | null = null

function notify(set: Set<() => void>) {
  for (const listener of set) listener()
}

/**
 * Kicks off the one-time IDB read that populates the in-memory cache.
 * Idempotent — repeated callers receive the same in-flight promise.
 * Failures fall through to an empty cache (defaults take effect); we don't
 * want a transient IDB error to block the entire timeline.
 */
export function hydrateCollapseCache(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (hydrationPromise) return hydrationPromise
  hydrationPromise = (async () => {
    try {
      const [blocks, previews] = await Promise.all([
        db.markdownBlockCollapse.toArray(),
        db.linkPreviewCollapse.toArray(),
      ])
      // Skip keys already in the cache so a user toggle that races with
      // hydration (e.g. a slow Dexie migration delays this read past first
      // interaction) doesn't get clobbered by the stale persisted value.
      for (const row of blocks) {
        if (!blockCollapse.has(row.id)) blockCollapse.set(row.id, row.collapsed)
      }
      for (const row of previews) {
        if (!linkPreviewExpand.has(row.id)) linkPreviewExpand.set(row.id, row.expanded)
      }
    } catch {
      // Empty cache → consumers fall back to their `defaultCollapsed` / `false`.
    } finally {
      hydrated = true
      notify(blockListeners)
      notify(linkPreviewListeners)
    }
  })()
  return hydrationPromise
}

export function setBlockCollapse(key: string, messageId: string, kind: MarkdownBlockKind, collapsed: boolean): void {
  blockCollapse.set(key, collapsed)
  notify(blockListeners)
  void db.markdownBlockCollapse.put({
    id: key,
    messageId,
    kind,
    collapsed,
    updatedAt: Date.now(),
  })
}

export function setLinkPreviewExpand(key: string, messageId: string, previewId: string, expanded: boolean): void {
  linkPreviewExpand.set(key, expanded)
  notify(linkPreviewListeners)
  void db.linkPreviewCollapse.put({
    id: key,
    messageId,
    previewId,
    expanded,
    updatedAt: Date.now(),
  })
}

function subscribeBlock(callback: () => void): () => void {
  blockListeners.add(callback)
  return () => {
    blockListeners.delete(callback)
  }
}

function subscribeLinkPreview(callback: () => void): () => void {
  linkPreviewListeners.add(callback)
  return () => {
    linkPreviewListeners.delete(callback)
  }
}

/**
 * Subscribes a component to a single block-collapse key. Returns `undefined`
 * when no row has been persisted for the key so consumers can fall back to
 * their default.
 */
export function useBlockCollapseStore(key: string | null): boolean | undefined {
  return useSyncExternalStore(
    subscribeBlock,
    () => (key ? blockCollapse.get(key) : undefined),
    () => undefined
  )
}

export function useLinkPreviewExpandStore(key: string | null): boolean | undefined {
  return useSyncExternalStore(
    subscribeLinkPreview,
    () => (key ? linkPreviewExpand.get(key) : undefined),
    () => undefined
  )
}

/**
 * Test-only helper to reset state between cases. Production code shouldn't
 * call this — the cache lives for the lifetime of the app.
 */
export function __resetCollapseCacheForTests(): void {
  blockCollapse.clear()
  linkPreviewExpand.clear()
  blockListeners.clear()
  linkPreviewListeners.clear()
  hydrated = false
  hydrationPromise = null
}
