import { useLiveQuery } from "dexie-react-hooks"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { db, type CachedScheduledMessage } from "@/db"
import { scheduledMessagesApi } from "@/api/scheduled-messages"
import { useSyncEngine } from "@/sync/sync-engine"
import type { ScheduledMessageView } from "@threa/types"

export const scheduledKeys = {
  all: ["scheduledMessages"] as const,
  list: (workspaceId: string, streamId?: string) => ["scheduledMessages", workspaceId, streamId] as const,
}

/** Write incoming server rows to IDB with cached metadata. */
export async function persistScheduledRows(_workspaceId: string, rows: ScheduledMessageView[]) {
  await db.scheduledMessages.bulkPut(
    rows.map((row) => ({
      ...row,
      contentJson:
        typeof row.contentJson === "string" ? JSON.parse(row.contentJson as unknown as string) : row.contentJson,
      _status: "synced" as const,
      _scheduledAtMs: Date.parse(row.scheduledAt),
      _cachedAt: Date.now(),
    }))
  )
}

/** Delete a single row from IDB. */
export async function removeScheduledRow(scheduledId: string) {
  await db.scheduledMessages.delete(scheduledId)
}

/** Bootstrap: subscribe-then-fetch pattern (INV-53). Uses fetch + bulkPut. */
function useScheduledBootstrap(workspaceId: string) {
  const engine = useSyncEngine()

  return useQuery({
    queryKey: scheduledKeys.list(workspaceId),
    queryFn: async () => {
      const result = await scheduledMessagesApi.list(workspaceId)
      await db.transaction("rw", db.scheduledMessages, async () => {
        // Remove stale rows for this workspace not in the response
        const serverIds = new Set(result.scheduled.map((r) => r.id))
        const local = await db.scheduledMessages.where("workspaceId").equals(workspaceId).toArray()
        const stale = local.filter((r) => !serverIds.has(r.id) && r._status === "synced")
        if (stale.length > 0) {
          await db.scheduledMessages.bulkDelete(stale.map((r) => r.id))
        }
        await persistScheduledRows(workspaceId, result.scheduled)
      })
      return result
    },
    enabled: !!workspaceId && !!engine,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

/** Live list from IDB for render (offline-ready). */
export function useScheduledList(workspaceId: string, streamId?: string) {
  useScheduledBootstrap(workspaceId)

  return useLiveQuery(async () => {
    let collection = db.scheduledMessages.where("workspaceId").equals(workspaceId)
    if (streamId) {
      collection = collection.and((row) => row.streamId === streamId)
    }
    const rows = await collection.sortBy("_scheduledAtMs")
    return rows.reverse()
  }, [workspaceId, streamId])
}

/** Schedule a message. Writes optimistically to IDB. */
export function useScheduleMessage(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: Parameters<typeof scheduledMessagesApi.schedule>[1]) =>
      scheduledMessagesApi.schedule(workspaceId, input),
    onMutate: async (input) => {
      // Optimistic IDB write
      const optimisticId = `pending_${Date.now()}`
      const optimistic: CachedScheduledMessage = {
        id: optimisticId,
        workspaceId,
        authorId: "",
        streamId: input.streamId,
        parentMessageId: input.parentMessageId,
        parentStreamId: input.parentStreamId,
        contentJson: input.contentJson,
        contentMarkdown: input.contentMarkdown,
        attachmentIds: input.attachmentIds ?? [],
        scheduledAt: input.scheduledAt,
        sentAt: null,
        cancelledAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        streamDisplayName: null,
        _status: "pending-sync",
        _scheduledAtMs: Date.parse(input.scheduledAt),
        _cachedAt: Date.now(),
      }
      await db.scheduledMessages.put(optimistic)
      return { optimisticId }
    },
    onSuccess: (result, _input, ctx) => {
      if (ctx) {
        void db.scheduledMessages.delete(ctx.optimisticId)
      }
      void persistScheduledRows("", [result.scheduled])
      queryClient.invalidateQueries({ queryKey: scheduledKeys.list(workspaceId) })
    },
    onError: (_error, _input, ctx) => {
      if (ctx) {
        void db.scheduledMessages.delete(ctx.optimisticId)
      }
    },
  })
}

/** Update a scheduled message. */
export function useUpdateScheduled(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof scheduledMessagesApi.update>[2] }) =>
      scheduledMessagesApi.update(workspaceId, id, input),
    onSuccess: (result) => {
      void persistScheduledRows(workspaceId, [result.scheduled])
      queryClient.invalidateQueries({ queryKey: scheduledKeys.list(workspaceId) })
    },
  })
}

/** Cancel a scheduled message. */
export function useCancelScheduled(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => scheduledMessagesApi.cancel(workspaceId, id),
    onMutate: async (id) => {
      await db.scheduledMessages.delete(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduledKeys.list(workspaceId) })
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: scheduledKeys.list(workspaceId) })
    },
  })
}
