import { ContextIntents, ContextRefKinds, type ContextBag } from "@threa/types"

/**
 * Build the ContextBag payload for "Discuss with Ariadne" on a given source
 * stream. Extracted as a helper so both the message context-menu action and
 * the `/discuss-with-ariadne` slash command emit the same shape.
 *
 * `sourceMessageId` is threaded through `originMessageId` (purely cosmetic,
 * resolver ignores it) so the chip can deep-link back to the exact message
 * the user shared from. We deliberately do NOT set `fromMessageId` — that
 * would slice the thread server-side and Ariadne would only see messages
 * from the clicked one onward, missing the conversation that led up to it.
 * Bag content stays whole-thread for the AI; navigation still hits the
 * specific message.
 */
export function buildDiscussWithAriadneBag(args: { sourceStreamId: string; sourceMessageId?: string }): ContextBag {
  return {
    intent: ContextIntents.DISCUSS_THREAD,
    refs: [
      {
        kind: ContextRefKinds.THREAD,
        streamId: args.sourceStreamId,
        ...(args.sourceMessageId ? { originMessageId: args.sourceMessageId } : {}),
      },
    ],
  }
}
