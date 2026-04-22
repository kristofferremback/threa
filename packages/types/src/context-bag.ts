// Context-bag primitive: a typed collection of context references attached to a
// stream, resolved on every AI turn. First consumer is "Discuss with Ariadne".
//
// A bag has an `intent` that drives the prompt template and a list of `refs`
// that point at content (threads today; memos/messages/streams later). The
// discriminated union on `kind` is deliberately single-branch for v1 so the
// downstream code already has shape to extend against.

export const ContextIntents = {
  DISCUSS_THREAD: "discuss-thread",
} as const
export type ContextIntent = (typeof ContextIntents)[keyof typeof ContextIntents]
export const CONTEXT_INTENTS = Object.values(ContextIntents) as ContextIntent[]

export const ContextRefKinds = {
  THREAD: "thread",
} as const
export type ContextRefKind = (typeof ContextRefKinds)[keyof typeof ContextRefKinds]
export const CONTEXT_REF_KINDS = Object.values(ContextRefKinds) as ContextRefKind[]

/**
 * A reference to a piece of context. v1 ships only the `thread` kind.
 * Omitting both `fromMessageId` and `toMessageId` means "whole thread, live-follow".
 */
export type ContextRef = {
  kind: typeof ContextRefKinds.THREAD
  streamId: string
  fromMessageId?: string
  toMessageId?: string
}

export interface ContextBag {
  intent: ContextIntent
  refs: ContextRef[]
}
