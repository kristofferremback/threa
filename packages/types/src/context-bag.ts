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
  /**
   * Optional lower slice anchor. When set, the resolver narrows the thread
   * to messages from this id onward. Triggers `formatContextRefLabel`'s
   * "Slice of …" framing. NOT used for navigation — see `originMessageId`.
   */
  fromMessageId?: string
  /** Optional upper slice anchor (inclusive). Same slicing semantics as `fromMessageId`. */
  toMessageId?: string
  /**
   * Originating message id for deep-linking back to the source — purely
   * cosmetic, the resolver ignores it. Lets a chip render "Click to open
   * the source thread" → `?m=<originMessageId>` without the resolver
   * slicing the thread to that one message.
   *
   * Set by "Discuss with Ariadne" so the chip jumps back to the message
   * the user right-clicked on; bag content stays whole-thread for the AI.
   */
  originMessageId?: string
}

export interface ContextBag {
  intent: ContextIntent
  refs: ContextRef[]
}
