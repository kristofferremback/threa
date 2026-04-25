/**
 * Build the deep-link URL for a context-ref source. Used by the composer
 * strip pill and the timeline message badge so clicking the chip jumps
 * back to the exact thread / message the discussion was started from.
 *
 * Threa uses `?m=<messageId>` as the canonical deep-link query param for
 * highlighting a message inside a stream (see `timeline-view.tsx` +
 * `event-item.tsx`'s `highlightMessageId`). When `fromMessageId` is set
 * we include it; otherwise we fall back to the stream URL alone.
 */
export function buildContextRefSourceHref(args: {
  workspaceId: string
  sourceStreamId: string
  /** Cosmetic deep-link target (`originMessageId`). Falls back to the stream URL when null. */
  originMessageId?: string | null
}): string {
  const base = `/w/${args.workspaceId}/s/${args.sourceStreamId}`
  return args.originMessageId ? `${base}?m=${args.originMessageId}` : base
}
