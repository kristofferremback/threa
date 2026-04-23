import { ContextIntents, ContextRefKinds, type ContextBag } from "@threa/types"

/**
 * Build the ContextBag payload for "Discuss with Ariadne" on a given source
 * stream. Extracted as a helper so both the message context-menu action and
 * the `/discuss-with-ariadne` slash command emit the same shape.
 *
 * Message-anchored vs whole-thread: when invoked from a specific message we
 * currently still send the whole thread as context — the client passes
 * `sourceStreamId` from wherever the action fired, and `originMessageId` is
 * reserved for future "narrow to this message's neighborhood" variants.
 */
export function buildDiscussWithAriadneBag(args: { sourceStreamId: string }): ContextBag {
  return {
    intent: ContextIntents.DISCUSS_THREAD,
    refs: [
      {
        kind: ContextRefKinds.THREAD,
        streamId: args.sourceStreamId,
      },
    ],
  }
}
