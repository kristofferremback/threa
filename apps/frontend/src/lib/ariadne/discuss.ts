import { ContextIntents, ContextRefKinds, type ContextBag } from "@threa/types"

/**
 * Build the ContextBag payload for "Discuss with Ariadne" on a given source
 * stream. Extracted as a helper so both the message context-menu action and
 * the `/discuss-with-ariadne` slash command emit the same shape.
 *
 * `sourceMessageId` is optional and threads through `fromMessageId` on the
 * ref so the chip in the new scratchpad can deep-link back to the exact
 * message the user shared from. When omitted (slash command from an empty
 * composer), the chip falls back to a stream-level link.
 */
export function buildDiscussWithAriadneBag(args: { sourceStreamId: string; sourceMessageId?: string }): ContextBag {
  return {
    intent: ContextIntents.DISCUSS_THREAD,
    refs: [
      {
        kind: ContextRefKinds.THREAD,
        streamId: args.sourceStreamId,
        ...(args.sourceMessageId ? { fromMessageId: args.sourceMessageId } : {}),
      },
    ],
  }
}
