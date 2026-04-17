import { useMemo } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSavedService } from "@/contexts"
import { db, type CachedSavedMessage } from "@/db"
import type {
  SavedMessageView,
  SavedMessageListResponse,
  SavedStatus,
  SaveMessageInput,
  UpdateSavedMessageInput,
} from "@threa/types"

export const savedKeys = {
  all: ["saved"] as const,
  list: (workspaceId: string, status: SavedStatus) => ["saved", workspaceId, status] as const,
  byMessageId: (workspaceId: string, messageId: string) => ["saved", workspaceId, "by-message", messageId] as const,
}

function toCached(view: SavedMessageView): CachedSavedMessage {
  return {
    id: view.id,
    workspaceId: view.workspaceId,
    userId: view.userId,
    messageId: view.messageId,
    streamId: view.streamId,
    status: view.status,
    remindAt: view.remindAt,
    reminderSentAt: view.reminderSentAt,
    savedAt: view.savedAt,
    statusChangedAt: view.statusChangedAt,
    message: view.message,
    unavailableReason: view.unavailableReason,
    _savedAtMs: Date.parse(view.savedAt),
    _statusChangedAtMs: Date.parse(view.statusChangedAt),
    _cachedAt: Date.now(),
  }
}

function fromCached(row: CachedSavedMessage): SavedMessageView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    messageId: row.messageId,
    streamId: row.streamId,
    status: row.status as SavedStatus,
    remindAt: row.remindAt,
    reminderSentAt: row.reminderSentAt,
    savedAt: row.savedAt,
    statusChangedAt: row.statusChangedAt,
    // IDB stores contentJson as unknown to avoid re-serialising; the server
    // is the authority, so the double cast is safe in practice.
    message: row.message as unknown as SavedMessageView["message"],
    unavailableReason: row.unavailableReason,
  }
}

/**
 * Write-through sync: after any list fetch or socket event, mirror the
 * authoritative rows into IDB so the next render — online or offline — reads
 * from the live Dexie query instead of the TanStack cache.
 */
export async function persistSavedRows(_workspaceId: string, rows: SavedMessageView[]): Promise<void> {
  if (rows.length === 0) return
  await db.savedMessages.bulkPut(rows.map(toCached))
}

export async function removeSavedRow(savedId: string): Promise<void> {
  await db.savedMessages.delete(savedId)
}

/**
 * Replace the current cached set for a (workspace, status) page with the
 * server's authoritative page. Rows not in the new page but still in IDB are
 * left alone — they may belong to other statuses or older pages.
 */
export async function replaceSavedPage(
  _workspaceId: string,
  _status: SavedStatus,
  rows: SavedMessageView[]
): Promise<void> {
  await db.savedMessages.bulkPut(rows.map(toCached))
}

/**
 * Live saved list backed by IDB, with server sync via TanStack Query. The
 * Dexie query is the render source so the Saved view works offline; the
 * server fetch runs in the background and rehydrates IDB when data arrives.
 *
 * Saved tab sorts by savedAt DESC; Done and Archived tabs sort by
 * statusChangedAt DESC.
 */
export function useSavedList(workspaceId: string, status: SavedStatus) {
  const savedService = useSavedService()

  const serverQuery = useQuery({
    queryKey: savedKeys.list(workspaceId, status),
    queryFn: async () => {
      const res = await savedService.list(workspaceId, { status, limit: 50 })
      await replaceSavedPage(workspaceId, status, res.saved)
      return res
    },
    // Re-run on mount after invalidation (reconnect hook in workspace-sync
    // invalidates `savedKeys.all` so offline-missed socket events get filled
    // in on the next render — INV-53).
    staleTime: Infinity,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    enabled: !!workspaceId,
  })

  const rows = useLiveQuery(async () => {
    if (!workspaceId) return [] as CachedSavedMessage[]
    const indexKey = status === "saved" ? "[workspaceId+status+_savedAtMs]" : "[workspaceId+status+_statusChangedAtMs]"
    return db.savedMessages
      .where(indexKey)
      .between([workspaceId, status, -Infinity], [workspaceId, status, Infinity], true, true)
      .reverse()
      .toArray()
  }, [workspaceId, status])

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
 * Cache-only observer for "is this message saved?" — reads from the IDB
 * messageId index so hover buttons and context menus don't trigger extra
 * fetches.
 */
export function useSavedForMessage(workspaceId: string, messageId: string | null) {
  return useLiveQuery(async () => {
    if (!workspaceId || !messageId) return null
    const row = await db.savedMessages
      .where("messageId")
      .equals(messageId)
      .and((r) => r.workspaceId === workspaceId)
      .first()
    return row ? fromCached(row) : null
  }, [workspaceId, messageId])
}

export function useSaveMessage(workspaceId: string) {
  const savedService = useSavedService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: SaveMessageInput) => savedService.create(workspaceId, input),
    onSuccess: (saved) => {
      void persistSavedRows(workspaceId, [saved])
      queryClient.invalidateQueries({ queryKey: savedKeys.list(workspaceId, "saved") })
      queryClient.invalidateQueries({ queryKey: savedKeys.list(workspaceId, "done") })
      queryClient.invalidateQueries({ queryKey: savedKeys.list(workspaceId, "archived") })
    },
  })
}

export function useUpdateSaved(workspaceId: string) {
  const savedService = useSavedService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ savedId, input }: { savedId: string; input: UpdateSavedMessageInput }) =>
      savedService.update(workspaceId, savedId, input),
    onSuccess: (saved) => {
      void persistSavedRows(workspaceId, [saved])
      queryClient.invalidateQueries({ queryKey: savedKeys.list(workspaceId, "saved") })
      queryClient.invalidateQueries({ queryKey: savedKeys.list(workspaceId, "done") })
      queryClient.invalidateQueries({ queryKey: savedKeys.list(workspaceId, "archived") })
    },
  })
}

export function useDeleteSaved(workspaceId: string) {
  const savedService = useSavedService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (savedId: string) => savedService.delete(workspaceId, savedId),
    onSuccess: (_res, savedId) => {
      void removeSavedRow(savedId)
      queryClient.invalidateQueries({ queryKey: savedKeys.list(workspaceId, "saved") })
      queryClient.invalidateQueries({ queryKey: savedKeys.list(workspaceId, "done") })
      queryClient.invalidateQueries({ queryKey: savedKeys.list(workspaceId, "archived") })
    },
  })
}

export type { SavedMessageListResponse }

/**
 * Live count of saved items with a fired-but-unacknowledged reminder. Used by
 * the sidebar badge — having saved things isn't itself noisy, but a fired
 * reminder is the signal worth surfacing. Filtered in-memory since Dexie
 * can't index on "reminderSentAt is not null"; the index still narrows to
 * (workspace, status="saved") so we only scan a small page.
 */
export function useLiveSavedCount(workspaceId: string): number {
  const count = useLiveQuery(async () => {
    if (!workspaceId) return 0
    const rows = await db.savedMessages
      .where("[workspaceId+status+_savedAtMs]")
      .between([workspaceId, "saved", -Infinity], [workspaceId, "saved", Infinity], true, true)
      .toArray()
    return rows.filter((row) => row.reminderSentAt !== null).length
  }, [workspaceId])
  return count ?? 0
}
