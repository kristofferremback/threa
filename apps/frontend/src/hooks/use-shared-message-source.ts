import { useEffect, useMemo, useState } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/db"
import { useSharedMessageHydration } from "@/components/shared-messages/context"

/**
 * Resolved preview for a shared-message pointer. `authorName` is optional at
 * the resolver level — the caller falls back to the cached attribute name
 * stamped on the node at share time.
 */
export interface SharedMessageResolved {
  status: "resolved"
  contentMarkdown: string
  authorId: string
  actorType: string
  authorName?: string
  editedAt: string | null
}

export interface SharedMessageDeleted {
  status: "deleted"
}

export interface SharedMessageMissing {
  status: "missing"
}

export interface SharedMessagePending {
  /** Still resolving. UI should stay blank for the staggered-skeleton delay. */
  status: "pending"
  /** Becomes true once the staggered-skeleton delay has elapsed. */
  showSkeleton: boolean
}

export type SharedMessageSource =
  | SharedMessageResolved
  | SharedMessageDeleted
  | SharedMessageMissing
  | SharedMessagePending

const SKELETON_DELAY_MS = 300

/**
 * Resolve a shared-message pointer's preview content in priority order:
 *
 *   1. Server-side hydration map (populated on stream bootstrap / events
 *      responses via `SharedMessagesProvider`). Authoritative for persisted
 *      pointers and reflects edits / tombstones.
 *   2. Local IndexedDB event cache. Covers the composer-preview case (pointer
 *      not sent yet, no server hydration exists) and any stream where the
 *      source message has already been paged in by the viewer.
 *   3. Pending — stays in the pending state and exposes `showSkeleton` once
 *      the staggered delay has elapsed, matching the rest of the app's
 *      loading semantics.
 *
 * Remote single-message fetch is intentionally not implemented here; the
 * two-tier cache covers the realistic Slice-1 cases and avoids adding a new
 * backend endpoint for a data shape the server already provides via the
 * hydration map.
 */
export function useSharedMessageSource(messageId: string, sourceStreamId: string): SharedMessageSource {
  const hydrated = useSharedMessageHydration(messageId)

  const cachedEvent = useLiveQuery(
    async () => {
      if (!sourceStreamId || !messageId) return null
      const events = await db.events
        .where("[streamId+eventType]")
        .equals([sourceStreamId, "message_created"])
        .filter((e) => (e.payload as { messageId?: string })?.messageId === messageId)
        .toArray()
      return events[0] ?? null
    },
    [messageId, sourceStreamId],
    null
  )

  const resolved = useMemo<SharedMessageSource | null>(() => {
    if (hydrated) {
      if (hydrated.state === "deleted") return { status: "deleted" }
      if (hydrated.state === "missing") return { status: "missing" }
      if (hydrated.state === "ok") {
        return {
          status: "resolved",
          contentMarkdown: hydrated.contentMarkdown,
          authorId: hydrated.authorId,
          actorType: hydrated.authorType,
          authorName: hydrated.authorName,
          editedAt: hydrated.editedAt,
        }
      }
    }

    if (cachedEvent) {
      const payload = cachedEvent.payload as { contentMarkdown?: string } | null
      return {
        status: "resolved",
        contentMarkdown: payload?.contentMarkdown ?? "",
        authorId: cachedEvent.actorId ?? "",
        actorType: cachedEvent.actorType ?? "user",
        editedAt: null,
      }
    }

    return null
  }, [hydrated, cachedEvent])

  const [showSkeleton, setShowSkeleton] = useState(false)

  useEffect(() => {
    if (resolved) {
      setShowSkeleton(false)
      return
    }
    const timer = setTimeout(() => setShowSkeleton(true), SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  }, [resolved])

  if (resolved) return resolved
  return { status: "pending", showSkeleton }
}
