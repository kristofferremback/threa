import { useLiveQuery } from "dexie-react-hooks"
import { db, type DraftMessage, type DraftScratchpad } from "@/db"

const cache = {
  scratchpads: new Map<string, DraftScratchpad[]>(),
  messages: new Map<string, DraftMessage[]>(),
}

const readyWorkspaces = new Set<string>()
const cacheVersion = new Map<string, number>()

function bumpVersion(workspaceId: string) {
  cacheVersion.set(workspaceId, (cacheVersion.get(workspaceId) ?? 0) + 1)
}

function useArrayStoreHook<T>(queryFn: () => Promise<T[]> | T[], deps: unknown[], cached: T[]): T[] {
  const live = useLiveQuery(queryFn, deps, cached) ?? []
  if (live.length === 0 && cached.length > 0) return cached
  return live
}

export function hasSeededDraftCache(workspaceId: string): boolean {
  return readyWorkspaces.has(workspaceId) && cache.scratchpads.has(workspaceId) && cache.messages.has(workspaceId)
}

export function resetDraftStoreCache(): void {
  cache.scratchpads.clear()
  cache.messages.clear()
  readyWorkspaces.clear()
  cacheVersion.clear()
}

export function seedDraftCache(
  workspaceId: string,
  data: { scratchpads: DraftScratchpad[]; messages: DraftMessage[] }
): void {
  bumpVersion(workspaceId)
  cache.scratchpads.set(workspaceId, data.scratchpads)
  cache.messages.set(workspaceId, data.messages)
  readyWorkspaces.add(workspaceId)
}

export async function seedDraftCacheFromIdb(workspaceId: string): Promise<void> {
  const versionBefore = cacheVersion.get(workspaceId) ?? 0
  const [scratchpads, messages] = await Promise.all([
    db.draftScratchpads.where("workspaceId").equals(workspaceId).toArray(),
    db.draftMessages.where("workspaceId").equals(workspaceId).toArray(),
  ])

  if ((cacheVersion.get(workspaceId) ?? 0) !== versionBefore) return

  seedDraftCache(workspaceId, {
    scratchpads,
    messages,
  })
}

export function useDraftScratchpadsFromStore(workspaceId: string | undefined): DraftScratchpad[] {
  const cached = workspaceId ? (cache.scratchpads.get(workspaceId) ?? []) : []
  return useArrayStoreHook(
    () => (workspaceId ? db.draftScratchpads.where("workspaceId").equals(workspaceId).toArray() : []),
    [workspaceId],
    cached
  )
}

export function useDraftMessagesFromStore(workspaceId: string | undefined): DraftMessage[] {
  const cached = workspaceId ? (cache.messages.get(workspaceId) ?? []) : []
  return useArrayStoreHook(
    () => (workspaceId ? db.draftMessages.where("workspaceId").equals(workspaceId).toArray() : []),
    [workspaceId],
    cached
  )
}

export function upsertDraftScratchpadInCache(workspaceId: string, draft: DraftScratchpad): void {
  const drafts = cache.scratchpads.get(workspaceId) ?? []
  const next = [...drafts]
  const index = next.findIndex((candidate) => candidate.id === draft.id)
  if (index === -1) {
    next.push(draft)
  } else {
    next[index] = draft
  }
  seedDraftCache(workspaceId, {
    scratchpads: next,
    messages: cache.messages.get(workspaceId) ?? [],
  })
}

export function deleteDraftScratchpadFromCache(workspaceId: string, draftId: string): void {
  seedDraftCache(workspaceId, {
    scratchpads: (cache.scratchpads.get(workspaceId) ?? []).filter((draft) => draft.id !== draftId),
    messages: cache.messages.get(workspaceId) ?? [],
  })
}

export function upsertDraftMessageInCache(workspaceId: string, draft: DraftMessage): void {
  const messages = cache.messages.get(workspaceId) ?? []
  const next = [...messages]
  const index = next.findIndex((candidate) => candidate.id === draft.id)
  if (index === -1) {
    next.push(draft)
  } else {
    next[index] = draft
  }
  seedDraftCache(workspaceId, {
    scratchpads: cache.scratchpads.get(workspaceId) ?? [],
    messages: next,
  })
}

export function deleteDraftMessageFromCache(workspaceId: string, draftId: string): void {
  seedDraftCache(workspaceId, {
    scratchpads: cache.scratchpads.get(workspaceId) ?? [],
    messages: (cache.messages.get(workspaceId) ?? []).filter((draft) => draft.id !== draftId),
  })
}
