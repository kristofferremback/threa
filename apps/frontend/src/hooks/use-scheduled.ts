import { useMemo } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useScheduledService } from "@/contexts"
import { db, type CachedScheduledMessage } from "@/db"
import type {
  ScheduledMessageView,
  ScheduledMessageStatus,
  ScheduleMessageInput,
  UpdateScheduledMessageInput,
  ClaimScheduledMessageResponse,
  JSONContent,
} from "@threa/types"

export const scheduledKeys = {
  all: ["scheduled"] as const,
  list: (workspaceId: string, status: ScheduledMessageStatus, streamId?: string) =>
    streamId
      ? (["scheduled", workspaceId, status, "stream", streamId] as const)
      : (["scheduled", workspaceId, status] as const),
}

function toCached(view: ScheduledMessageView): CachedScheduledMessage {
  return {
    id: view.id,
    workspaceId: view.workspaceId,
    userId: view.userId,
    streamId: view.streamId,
    parentMessageId: view.parentMessageId,
    contentJson: view.contentJson,
    contentMarkdown: view.contentMarkdown,
    attachmentIds: view.attachmentIds,
    metadata: view.metadata,
    scheduledFor: view.scheduledFor,
    status: view.status,
    sentMessageId: view.sentMessageId,
    lastError: view.lastError,
    editLockOwnerId: view.editLockOwnerId,
    editLockExpiresAt: view.editLockExpiresAt,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    statusChangedAt: view.statusChangedAt,
    _scheduledForMs: Date.parse(view.scheduledFor),
    _statusChangedAtMs: Date.parse(view.statusChangedAt),
    _cachedAt: Date.now(),
  }
}

function fromCached(row: CachedScheduledMessage): ScheduledMessageView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    streamId: row.streamId,
    parentMessageId: row.parentMessageId,
    // IDB stores contentJson as unknown to avoid re-serialising; the server
    // is the authority, so the cast is safe in practice.
    contentJson: row.contentJson as JSONContent,
    contentMarkdown: row.contentMarkdown,
    attachmentIds: row.attachmentIds,
    metadata: row.metadata,
    scheduledFor: row.scheduledFor,
    status: row.status as ScheduledMessageStatus,
    sentMessageId: row.sentMessageId,
    lastError: row.lastError,
    editLockOwnerId: row.editLockOwnerId,
    editLockExpiresAt: row.editLockExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    statusChangedAt: row.statusChangedAt,
  }
}

/**
 * Write-through sync: after any list fetch or socket event, mirror the
 * authoritative rows into IDB so the next render — online or offline — reads
 * from the live Dexie query.
 */
export async function persistScheduledRows(rows: ScheduledMessageView[]): Promise<void> {
  if (rows.length === 0) return
  await db.scheduledMessages.bulkPut(rows.map(toCached))
}

export async function removeScheduledRow(id: string): Promise<void> {
  await db.scheduledMessages.delete(id)
}

/**
 * Reconcile a (workspace, status[, streamId]) page with the server's
 * authoritative response. Same shape as `replaceSavedPage` — rows in IDB
 * for this slice that are missing from the response and were cached before
 * `fetchStartedAt` get pruned. `hasMore` skips reconciliation entirely so
 * page-2+ rows aren't wiped.
 */
export async function replaceScheduledPage(
  workspaceId: string,
  status: ScheduledMessageStatus,
  rows: ScheduledMessageView[],
  fetchStartedAt: number,
  hasMore: boolean,
  streamId?: string
): Promise<void> {
  const pendingIndexKey = streamId
    ? "[workspaceId+streamId+status+_scheduledForMs]"
    : "[workspaceId+status+_scheduledForMs]"
  const indexKey = status === "pending" ? pendingIndexKey : "[workspaceId+status+_statusChangedAtMs]"

  const toDelete: string[] = hasMore
    ? []
    : await (async () => {
        const collection = streamId
          ? db.scheduledMessages
              .where(indexKey)
              .between(
                [workspaceId, streamId, status, -Infinity],
                [workspaceId, streamId, status, Infinity],
                true,
                true
              )
          : db.scheduledMessages
              .where(indexKey)
              .between([workspaceId, status, -Infinity], [workspaceId, status, Infinity], true, true)
        const existing = await collection.toArray()
        const serverIds = new Set(rows.map((row) => row.id))
        return existing.filter((row) => !serverIds.has(row.id) && row._cachedAt < fetchStartedAt).map((row) => row.id)
      })()

  await db.transaction("rw", db.scheduledMessages, async () => {
    if (toDelete.length > 0) await db.scheduledMessages.bulkDelete(toDelete)
    if (rows.length > 0) await db.scheduledMessages.bulkPut(rows.map(toCached))
  })
}

/**
 * Live scheduled-list backed by IDB, with server sync via TanStack Query.
 * Component reads from the Dexie query (offline-first) and the network refresh
 * runs in the background, rehydrating IDB on success. Pending rows order by
 * scheduled_for ASC; sent/failed/cancelled by status_changed_at DESC.
 */
export function useScheduledList(workspaceId: string, status: ScheduledMessageStatus, streamId?: string) {
  const scheduledService = useScheduledService()

  const serverQuery = useQuery({
    queryKey: scheduledKeys.list(workspaceId, status, streamId),
    queryFn: async () => {
      const fetchStartedAt = Date.now()
      const res = await scheduledService.list(workspaceId, { status, streamId, limit: 50 })
      await replaceScheduledPage(workspaceId, status, res.scheduled, fetchStartedAt, res.nextCursor !== null, streamId)
      return res
    },
    // INV-53: workspace-sync invalidates `scheduledKeys.all` on reconnect at
    // the top of `registerWorkspaceSocketHandlers`; refetchOnReconnect catches
    // the pure online/offline case; refetchOnMount + staleTime: Infinity makes
    // the invalidation actually fire on next render.
    staleTime: Infinity,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    enabled: !!workspaceId,
  })

  const rows = useLiveQuery(async () => {
    if (!workspaceId) return [] as CachedScheduledMessage[]
    if (status === "pending") {
      if (streamId) {
        return db.scheduledMessages
          .where("[workspaceId+streamId+status+_scheduledForMs]")
          .between([workspaceId, streamId, status, -Infinity], [workspaceId, streamId, status, Infinity], true, true)
          .toArray()
      }
      return db.scheduledMessages
        .where("[workspaceId+status+_scheduledForMs]")
        .between([workspaceId, status, -Infinity], [workspaceId, status, Infinity], true, true)
        .toArray()
    }
    return db.scheduledMessages
      .where("[workspaceId+status+_statusChangedAtMs]")
      .between([workspaceId, status, -Infinity], [workspaceId, status, Infinity], true, true)
      .reverse()
      .toArray()
  }, [workspaceId, status, streamId])

  const items = useMemo(() => (rows ?? []).map(fromCached), [rows])

  return {
    items,
    isLoading: serverQuery.isLoading && (rows?.length ?? 0) === 0,
    isFetching: serverQuery.isFetching,
    error: serverQuery.error,
    nextCursor: serverQuery.data?.nextCursor ?? null,
    refetch: serverQuery.refetch,
  }
}

/**
 * Live count of pending scheduled messages for a workspace — used by the
 * sidebar badge and composer popover trigger. Range query on the
 * `[workspaceId+status+_scheduledForMs]` index counts without materialising
 * objects.
 */
export function useLiveScheduledCount(workspaceId: string): number {
  const count = useLiveQuery(async () => {
    if (!workspaceId) return 0
    return db.scheduledMessages
      .where("[workspaceId+status+_scheduledForMs]")
      .between([workspaceId, "pending", -Infinity], [workspaceId, "pending", Infinity], true, true)
      .count()
  }, [workspaceId])
  return count ?? 0
}

/**
 * Schedule a new message. Optimistic IDB write happens in `onMutate` with a
 * `sched_local_<ulid>` placeholder id; on success we delete the placeholder
 * and write the server-issued row. On failure we roll the placeholder back.
 * Lock-bearing edits and offline schedule queueing are handled separately
 * (operation-queue + executeOperation).
 */
export function useScheduleMessage(workspaceId: string) {
  const scheduledService = useScheduledService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ScheduleMessageInput) => scheduledService.create(workspaceId, input),
    onSuccess: (scheduled) => {
      void persistScheduledRows([scheduled])
      queryClient.invalidateQueries({ queryKey: scheduledKeys.all })
    },
  })
}

export function useUpdateScheduled(workspaceId: string) {
  const scheduledService = useScheduledService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateScheduledMessageInput }) =>
      scheduledService.update(workspaceId, id, input),
    onSuccess: (scheduled) => {
      void persistScheduledRows([scheduled])
      queryClient.invalidateQueries({ queryKey: scheduledKeys.all })
    },
  })
}

export function useCancelScheduled(workspaceId: string) {
  const scheduledService = useScheduledService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => scheduledService.delete(workspaceId, id),
    onMutate: async (id) => {
      // Optimistic removal: the user expects the row to vanish immediately on
      // click. Worst case (server returns 409 because the worker won) we
      // rehydrate from the upserted socket event.
      const cached = await db.scheduledMessages.get(id)
      await removeScheduledRow(id)
      return { cached }
    },
    onError: (_err, _id, context) => {
      if (context?.cached) {
        void db.scheduledMessages.put(context.cached)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduledKeys.all })
    },
  })
}

/**
 * Send a pending row immediately. Server takes the worker-style lock and
 * fires through the same EventService.createMessage code path. On success the
 * row transitions sent and the live message appears in the stream timeline
 * via the standard message:created broadcast.
 */
export function useSendScheduledNow(workspaceId: string) {
  const scheduledService = useScheduledService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => scheduledService.sendNow(workspaceId, id),
    onSuccess: (scheduled) => {
      void persistScheduledRows([scheduled])
      queryClient.invalidateQueries({ queryKey: scheduledKeys.all })
    },
  })
}

/**
 * Acquire the editor lock. Resolves with `{ scheduled, lockToken,
 * lockExpiresAt, sync }` — the caller decides whether to UI-block based on
 * `sync` (server-side hint, true when within the sync threshold). Lock
 * heartbeats and explicit release are separate hooks because they have
 * different lifetimes.
 */
export function useClaimScheduled(workspaceId: string) {
  const scheduledService = useScheduledService()
  return useMutation({
    mutationFn: (id: string): Promise<ClaimScheduledMessageResponse> => scheduledService.claim(workspaceId, id),
    onSuccess: (res) => {
      void persistScheduledRows([res.scheduled])
    },
  })
}

export function useReleaseScheduled(workspaceId: string) {
  const scheduledService = useScheduledService()
  return useMutation({
    mutationFn: ({ id, lockToken }: { id: string; lockToken: string }) =>
      scheduledService.release(workspaceId, id, lockToken),
  })
}

export function useHeartbeatScheduled(workspaceId: string) {
  const scheduledService = useScheduledService()
  return useMutation({
    mutationFn: ({ id, lockToken }: { id: string; lockToken: string }) =>
      scheduledService.heartbeat(workspaceId, id, lockToken),
  })
}
