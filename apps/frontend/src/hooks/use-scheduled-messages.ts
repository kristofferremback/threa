import { useMemo } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useScheduledMessagesService } from "@/contexts"
import { db, type CachedScheduledMessage } from "@/db"
import {
  ScheduledMessageStatuses,
  type CreateScheduledMessageInput,
  type ScheduledMessageView,
  type UpdateScheduledMessageInput,
} from "@threa/types"

export const scheduledMessageKeys = {
  all: ["scheduledMessages"] as const,
  list: (workspaceId: string) => ["scheduledMessages", workspaceId] as const,
}

function toCached(view: ScheduledMessageView): CachedScheduledMessage {
  return {
    id: view.id,
    workspaceId: view.workspaceId,
    userId: view.userId,
    streamId: view.streamId,
    status: view.status,
    scheduledAt: view.scheduledAt,
    contentJson: view.contentJson,
    contentMarkdown: view.contentMarkdown,
    attachmentIds: view.attachmentIds,
    sentMessageId: view.sentMessageId,
    version: view.version,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    sentAt: view.sentAt,
    deletedAt: view.deletedAt,
    failedAt: view.failedAt,
    failureReason: view.failureReason,
    streamName: view.streamName,
    _scheduledAtMs: Date.parse(view.scheduledAt),
    _updatedAtMs: Date.parse(view.updatedAt),
    _cachedAt: Date.now(),
  }
}

function fromCached(row: CachedScheduledMessage): ScheduledMessageView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    streamId: row.streamId,
    status: row.status as ScheduledMessageView["status"],
    scheduledAt: row.scheduledAt,
    contentJson: row.contentJson as ScheduledMessageView["contentJson"],
    contentMarkdown: row.contentMarkdown,
    attachmentIds: row.attachmentIds,
    sentMessageId: row.sentMessageId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sentAt: row.sentAt,
    deletedAt: row.deletedAt,
    failedAt: row.failedAt,
    failureReason: row.failureReason,
    streamName: row.streamName,
  }
}

export async function persistScheduledRows(rows: ScheduledMessageView[]): Promise<void> {
  if (rows.length === 0) return
  await db.scheduledMessages.bulkPut(rows.map(toCached))
}

export async function removeScheduledRow(scheduledId: string): Promise<void> {
  await db.scheduledMessages.delete(scheduledId)
}

async function replaceScheduledList(workspaceId: string, rows: ScheduledMessageView[], fetchStartedAt: number) {
  const serverIds = new Set(rows.map((row) => row.id))
  const existing = await db.scheduledMessages.where("workspaceId").equals(workspaceId).toArray()
  const staleIds = existing
    .filter((row) => !serverIds.has(row.id) && row._cachedAt < fetchStartedAt)
    .map((row) => row.id)

  await db.transaction("rw", db.scheduledMessages, async () => {
    if (staleIds.length > 0) await db.scheduledMessages.bulkDelete(staleIds)
    if (rows.length > 0) await db.scheduledMessages.bulkPut(rows.map(toCached))
  })
}

export function useScheduledMessagesList(workspaceId: string) {
  const service = useScheduledMessagesService()
  const serverQuery = useQuery({
    queryKey: scheduledMessageKeys.list(workspaceId),
    queryFn: async () => {
      const fetchStartedAt = Date.now()
      const res = await service.list(workspaceId)
      await replaceScheduledList(workspaceId, res.scheduled, fetchStartedAt)
      return res
    },
    staleTime: Infinity,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    enabled: !!workspaceId,
  })

  const rows = useLiveQuery(async () => {
    if (!workspaceId) return [] as CachedScheduledMessage[]
    return db.scheduledMessages
      .where("[workspaceId+_scheduledAtMs]")
      .between([workspaceId, -Infinity], [workspaceId, Infinity], true, true)
      .toArray()
  }, [workspaceId])

  const items = useMemo(() => (rows ?? []).map(fromCached), [rows])
  return {
    items,
    isLoading: serverQuery.isLoading && (rows?.length ?? 0) === 0,
    isFetching: serverQuery.isFetching,
    error: serverQuery.error,
    refetch: serverQuery.refetch,
  }
}

export function useScheduledMessagesCount(workspaceId: string): number {
  const service = useScheduledMessagesService()
  useQuery({
    queryKey: scheduledMessageKeys.list(workspaceId),
    queryFn: async () => {
      const fetchStartedAt = Date.now()
      const res = await service.list(workspaceId)
      await replaceScheduledList(workspaceId, res.scheduled, fetchStartedAt)
      return res
    },
    staleTime: Infinity,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    enabled: !!workspaceId,
  })

  const count = useLiveQuery(async () => {
    if (!workspaceId) return 0
    const statuses = [
      ScheduledMessageStatuses.SCHEDULED,
      ScheduledMessageStatuses.PAUSED,
      ScheduledMessageStatuses.EDITING,
      ScheduledMessageStatuses.FAILED,
    ]
    let total = 0
    for (const status of statuses) {
      total += await db.scheduledMessages
        .where("[workspaceId+status+_scheduledAtMs]")
        .between([workspaceId, status, -Infinity], [workspaceId, status, Infinity], true, true)
        .count()
    }
    return total
  }, [workspaceId])
  return count ?? 0
}

export function useCreateScheduledMessage(workspaceId: string) {
  const service = useScheduledMessagesService()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateScheduledMessageInput) => service.create(workspaceId, input),
    onSuccess: async (scheduled) => {
      await persistScheduledRows([scheduled])
      queryClient.invalidateQueries({ queryKey: scheduledMessageKeys.list(workspaceId) })
    },
  })
}

export function useUpdateScheduledMessage(workspaceId: string) {
  const service = useScheduledMessagesService()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ scheduledId, input }: { scheduledId: string; input: UpdateScheduledMessageInput }) =>
      service.update(workspaceId, scheduledId, input),
    onSuccess: async (scheduled) => {
      await persistScheduledRows([scheduled])
      queryClient.invalidateQueries({ queryKey: scheduledMessageKeys.list(workspaceId) })
    },
  })
}

export function usePauseScheduledMessage(workspaceId: string) {
  const service = useScheduledMessagesService()
  return useScheduledAction(workspaceId, (scheduledId, expectedVersion) =>
    service.pause(workspaceId, scheduledId, { expectedVersion })
  )
}

export function useResumeScheduledMessage(workspaceId: string) {
  const service = useScheduledMessagesService()
  return useScheduledAction(workspaceId, (scheduledId, expectedVersion) =>
    service.resume(workspaceId, scheduledId, { expectedVersion })
  )
}

export function useSendScheduledMessageNow(workspaceId: string) {
  const service = useScheduledMessagesService()
  return useScheduledAction(workspaceId, (scheduledId, expectedVersion) =>
    service.sendNow(workspaceId, scheduledId, { expectedVersion })
  )
}

export function useEditLockScheduledMessage(workspaceId: string) {
  const service = useScheduledMessagesService()
  return useScheduledAction(workspaceId, (scheduledId, expectedVersion) =>
    service.editLock(workspaceId, scheduledId, { expectedVersion })
  )
}

function useScheduledAction(
  workspaceId: string,
  action: (scheduledId: string, expectedVersion?: number) => Promise<ScheduledMessageView>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ scheduledId, expectedVersion }: { scheduledId: string; expectedVersion?: number }) =>
      action(scheduledId, expectedVersion),
    onSuccess: async (scheduled) => {
      await persistScheduledRows([scheduled])
      queryClient.invalidateQueries({ queryKey: scheduledMessageKeys.list(workspaceId) })
    },
  })
}

export function useDeleteScheduledMessage(workspaceId: string) {
  const service = useScheduledMessagesService()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ scheduledId, expectedVersion }: { scheduledId: string; expectedVersion?: number }) =>
      service.delete(workspaceId, scheduledId, { expectedVersion }),
    onSuccess: async (_result, vars) => {
      await removeScheduledRow(vars.scheduledId)
      queryClient.invalidateQueries({ queryKey: scheduledMessageKeys.list(workspaceId) })
    },
  })
}
