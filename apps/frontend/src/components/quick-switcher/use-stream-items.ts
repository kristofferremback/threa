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

    const matchesQuery = (stream: Stream) => {
      if (!query) return true
      const displayName = getStreamDisplayName(stream).toLowerCase()
      return displayName.includes(lowerQuery) || stream.id.toLowerCase().includes(lowerQuery)
    }

    const filteredStreams = topLevelStreams.filter(matchesQuery)

    const result: QuickSwitcherItem[] = []

    // Group by type
    const scratchpads = filteredStreams.filter((s) => s.type === StreamTypes.SCRATCHPAD)
    const channels = filteredStreams.filter((s) => s.type === StreamTypes.CHANNEL)
    const dms = filteredStreams.filter((s) => s.type === StreamTypes.DM)

    for (const stream of scratchpads) {
      result.push({
        id: stream.id,
        label: getStreamDisplayName(stream),
        icon: STREAM_ICONS[stream.type],
        group: "Scratchpads",
        onSelect: () => {
          closeDialog()
          navigate(`/w/${workspaceId}/s/${stream.id}`)
        },
      })
    }

    for (const stream of channels) {
      result.push({
        id: stream.id,
        label: getStreamDisplayName(stream),
        icon: STREAM_ICONS[stream.type],
        group: "Channels",
        onSelect: () => {
          closeDialog()
          navigate(`/w/${workspaceId}/s/${stream.id}`)
        },
      })
    }

    for (const stream of dms) {
      result.push({
        id: stream.id,
        label: getStreamDisplayName(stream),
        icon: STREAM_ICONS[stream.type],
        group: "Direct Messages",
        onSelect: () => {
          closeDialog()
          navigate(`/w/${workspaceId}/s/${stream.id}`)
        },
      })
    }

    return result
  }, [streams, query, workspaceId, navigate, closeDialog])

  return {
    items,
    emptyMessage: "No streams found.",
  }
}
