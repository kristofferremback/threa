import { StreamTypes } from "@threa/types"
import type { Stream } from "@threa/types"

/** Format a stream's display name for UI: channels get `#slug`, others get displayName. */
export function getStreamDisplayName(stream: Pick<Stream, "type" | "slug" | "displayName">): string {
  if (stream.type === StreamTypes.CHANNEL && stream.slug) {
    return `#${stream.slug}`
  }
  return stream.displayName || "Untitled"
}
