const START_BATCH_SELECT_EVENT = "threa:start-batch-select"

interface BatchSelectEventDetail {
  streamId: string
  /**
   * When the move flow is launched from a per-message context menu, the
   * single message acts as the initial selection so the user can either
   * confirm immediately or extend the selection. Absent for the
   * stream-level "Move messages…" entry, which starts with nothing
   * selected.
   */
  preselectedMessageId?: string
}

export function dispatchStartBatchSelect(streamId: string, preselectedMessageId?: string): void {
  document.dispatchEvent(
    new CustomEvent<BatchSelectEventDetail>(START_BATCH_SELECT_EVENT, {
      detail: { streamId, preselectedMessageId },
    })
  )
}

export function addStartBatchSelectListener(listener: (detail: BatchSelectEventDetail) => void): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<BatchSelectEventDetail>).detail)
  }

  document.addEventListener(START_BATCH_SELECT_EVENT, handleEvent)
  return () => document.removeEventListener(START_BATCH_SELECT_EVENT, handleEvent)
}
