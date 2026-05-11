import type { LastRenderedSnapshot, SummaryInput } from "./types"

export interface DiffResult {
  appends: SummaryInput[]
  edits: Array<{ current: SummaryInput; previous: SummaryInput }>
  deletes: SummaryInput[]
}

/**
 * Compare the current bag state against the previous snapshot. One pass, O(n):
 *
 * - append: current has messageId not in previous
 * - edit:   messageId in both but contentFingerprint differs
 * - delete: messageId in previous, absent from current (or marked deleted)
 *
 * Ordering inside each bucket follows the order of `current`/`previous` so
 * delta rendering remains deterministic across turns with identical state.
 */
export function diffInputs(current: SummaryInput[], previous: LastRenderedSnapshot | null): DiffResult {
  if (!previous) {
    return { appends: [], edits: [], deletes: [] }
  }

  const previousById = new Map(previous.items.map((item) => [item.messageId, item]))
  const currentIds = new Set(current.map((item) => item.messageId))

  const appends: SummaryInput[] = []
  const edits: Array<{ current: SummaryInput; previous: SummaryInput }> = []

  for (const item of current) {
    const previousItem = previousById.get(item.messageId)
    if (!previousItem) {
      appends.push(item)
      continue
    }
    if (previousItem.contentFingerprint !== item.contentFingerprint || previousItem.deleted !== item.deleted) {
      edits.push({ current: item, previous: previousItem })
    }
  }

  const deletes: SummaryInput[] = []
  for (const item of previous.items) {
    if (!currentIds.has(item.messageId) && !item.deleted) {
      deletes.push({ ...item, deleted: true })
    }
  }

  return { appends, edits, deletes }
}
