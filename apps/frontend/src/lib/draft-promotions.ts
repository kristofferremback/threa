/**
 * Lightweight in-memory event bus for draft-to-real stream promotions.
 *
 * When the background message queue successfully creates a stream from a draft
 * (scratchpad or thread), it emits a promotion event. UI components listen for
 * these events to navigate from the draft view to the real stream.
 *
 * INV-9 exception: module-level singleton is intentional here. This is a
 * transient in-memory pub/sub scoped to the current tab — listeners are
 * added/removed via React effect cleanup, so no leak risk. A context-based
 * alternative would require threading the emitter through the component tree
 * from the message queue (hook layer) to unrelated UI consumers, adding
 * coupling for no practical benefit.
 */

export interface DraftPromotion {
  draftId: string
  realStreamId: string
  workspaceId: string
}

type Listener = (promotion: DraftPromotion) => void

const listeners = new Set<Listener>()

export function onDraftPromoted(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitDraftPromoted(promotion: DraftPromotion): void {
  for (const listener of listeners) {
    listener(promotion)
  }
}
