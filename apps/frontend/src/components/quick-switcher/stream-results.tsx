import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { FileText, Hash, MessageSquare } from "lucide-react"
import { CommandGroup, CommandItem, CommandEmpty } from "@/components/ui/command"
import type { Stream, StreamType } from "@threa/types"
import { StreamTypes } from "@threa/types"

interface StreamResultsProps {
  workspaceId: string
  streams: Stream[]
  onSelect: () => void
}

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

export function StreamResults({ workspaceId, streams, onSelect }: StreamResultsProps) {
  const navigate = useNavigate()

  const groupedStreams = useMemo(() => {
    const topLevelStreams = streams.filter(
      (s) => s.type === StreamTypes.SCRATCHPAD || s.type === StreamTypes.CHANNEL || s.type === StreamTypes.DM
    )

    return {
      scratchpads: topLevelStreams.filter((s) => s.type === StreamTypes.SCRATCHPAD),
      channels: topLevelStreams.filter((s) => s.type === StreamTypes.CHANNEL),
      dms: topLevelStreams.filter((s) => s.type === StreamTypes.DM),
    }
  }, [streams])

  const handleSelect = (streamId: string) => {
    onSelect()
    navigate(`/w/${workspaceId}/s/${streamId}`)
  }

  const hasResults =
    groupedStreams.scratchpads.length > 0 || groupedStreams.channels.length > 0 || groupedStreams.dms.length > 0

  if (!hasResults) {
    return <CommandEmpty>No streams found.</CommandEmpty>
  }

  return (
    <>
      {groupedStreams.scratchpads.length > 0 && (
        <CommandGroup heading="Scratchpads">
          {groupedStreams.scratchpads.map((stream) => {
            const Icon = STREAM_ICONS[stream.type]
            return (
              <CommandItem
                key={stream.id}
                value={`${stream.id} ${getStreamDisplayName(stream)}`}
                onSelect={() => handleSelect(stream.id)}
              >
                <Icon className="mr-2 h-4 w-4 opacity-50" />
                <span>{getStreamDisplayName(stream)}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>
      )}

      {groupedStreams.channels.length > 0 && (
        <CommandGroup heading="Channels">
          {groupedStreams.channels.map((stream) => {
            const Icon = STREAM_ICONS[stream.type]
            return (
              <CommandItem
                key={stream.id}
                value={`${stream.id} ${getStreamDisplayName(stream)}`}
                onSelect={() => handleSelect(stream.id)}
              >
                <Icon className="mr-2 h-4 w-4 opacity-50" />
                <span>{getStreamDisplayName(stream)}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>
      )}

      {groupedStreams.dms.length > 0 && (
        <CommandGroup heading="Direct Messages">
          {groupedStreams.dms.map((stream) => {
            const Icon = STREAM_ICONS[stream.type]
            return (
              <CommandItem
                key={stream.id}
                value={`${stream.id} ${getStreamDisplayName(stream)}`}
                onSelect={() => handleSelect(stream.id)}
              >
                <Icon className="mr-2 h-4 w-4 opacity-50" />
                <span>{getStreamDisplayName(stream)}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>
      )}
    </>
  )
}
