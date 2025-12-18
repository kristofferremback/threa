import { useLiveQuery } from "dexie-react-hooks"
import { useCallback } from "react"
import { db, type DraftScratchpad } from "@/db"
import type { CompanionMode } from "@/types/domain"

function generateDraftId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `draft_${timestamp}${random}`
}

export function isDraftId(id: string): boolean {
  return id.startsWith("draft_")
}

export function useDraftScratchpads(workspaceId: string) {
  const drafts = useLiveQuery(
    () => db.draftScratchpads.where("workspaceId").equals(workspaceId).toArray(),
    [workspaceId],
    []
  )

  const createDraft = useCallback(
    async (companionMode: CompanionMode = "on"): Promise<string> => {
      const id = generateDraftId()
      await db.draftScratchpads.add({
        id,
        workspaceId,
        displayName: null,
        companionMode,
        createdAt: Date.now(),
      })
      return id
    },
    [workspaceId]
  )

  const updateDraft = useCallback(
    async (id: string, data: Partial<Pick<DraftScratchpad, "displayName" | "companionMode">>) => {
      await db.draftScratchpads.update(id, data)
    },
    []
  )

  const deleteDraft = useCallback(async (id: string) => {
    await db.draftScratchpads.delete(id)
  }, [])

  const getDraft = useCallback(
    (id: string): DraftScratchpad | undefined => {
      return drafts?.find((d) => d.id === id)
    },
    [drafts]
  )

  return {
    drafts: drafts ?? [],
    createDraft,
    updateDraft,
    deleteDraft,
    getDraft,
  }
}
