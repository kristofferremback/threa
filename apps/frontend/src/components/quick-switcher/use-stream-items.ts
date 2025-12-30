import { useMemo } from "react"
import { FileText, Hash, MessageSquare } from "lucide-react"
import { StreamTypes } from "@threa/types"
import type { Stream, StreamType } from "@threa/types"
import type { ModeContext, ModeResult, QuickSwitcherItem } from "./types"

const STREAM_ICONS: Record<StreamType, React.ComponentType<{ className?: string }>> = {
  [StreamTypes.SCRATCHPAD]: FileText,
  [StreamTypes.CHANNEL]: Hash,
  [StreamTypes.DM]: MessageSquare,
  [StreamTypes.THREAD]: MessageSquare,
}

function getStreamDisplayName(stream: Stream): string {
  if (stream.type === StreamTypes.CHANNEL && stream.slug) {
    return `#${stream.slug}`
  }
  return stream.displayName || "Untitled"
}

export function useStreamItems(context: ModeContext): ModeResult {
  const { streams, query, workspaceId, navigate, closeDialog } = context

  const items = useMemo(() => {
    const lowerQuery = query.toLowerCase()

    const topLevelStreams = streams.filter(
      (s) => s.type === StreamTypes.SCRATCHPAD || s.type === StreamTypes.CHANNEL || s.type === StreamTypes.DM
    )

    // Score streams by match quality (lower = better)
    const scoreStream = (stream: Stream): number => {
      if (!query) return 0
      const name = getStreamDisplayName(stream).toLowerCase()
      if (name === lowerQuery) return 0 // Exact match
      if (name.startsWith(lowerQuery)) return 1 // Starts with
      if (name.includes(lowerQuery)) return 2 // Contains
      if (stream.id.toLowerCase().includes(lowerQuery)) return 3 // ID match
      return Infinity // No match
    }

    return topLevelStreams
      .map((stream) => ({ stream, score: scoreStream(stream) }))
      .filter(({ score }) => score !== Infinity)
      .sort((a, b) => a.score - b.score || a.stream.displayName.localeCompare(b.stream.displayName))
      .map(({ stream }): QuickSwitcherItem => {
        const href = `/w/${workspaceId}/s/${stream.id}`
        return {
          id: stream.id,
          label: getStreamDisplayName(stream),
          icon: STREAM_ICONS[stream.type],
          href,
          onSelect: () => {
            closeDialog()
            navigate(href)
          },
        }
      })
  }, [streams, query, workspaceId, navigate, closeDialog])

  return {
    items,
    emptyMessage: "No streams found.",
  }
}
