const START_BATCH_SELECT_EVENT = "threa:start-batch-select"

interface BatchSelectEventDetail {
  streamId: string
}

export function dispatchStartBatchSelect(streamId: string): void {
  document.dispatchEvent(new CustomEvent<BatchSelectEventDetail>(START_BATCH_SELECT_EVENT, { detail: { streamId } }))
}

export function addStartBatchSelectListener(listener: (detail: BatchSelectEventDetail) => void): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<BatchSelectEventDetail>).detail)
  }

  document.addEventListener(START_BATCH_SELECT_EVENT, handleEvent)
  return () => document.removeEventListener(START_BATCH_SELECT_EVENT, handleEvent)
}
