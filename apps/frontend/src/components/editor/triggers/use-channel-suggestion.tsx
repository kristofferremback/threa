import { useCallback, useMemo } from "react"
import { useParams } from "react-router-dom"
import type { ChannelItem } from "./types"
import { ChannelList } from "./channel-list"
import { useWorkspaceBootstrap } from "@/hooks/use-workspaces"
import { useSuggestion } from "./use-suggestion"

/**
 * Filter channels by query string.
 * Matches against slug and name, case-insensitive.
 */
function filterChannels(items: ChannelItem[], query: string): ChannelItem[] {
  if (!query) return items

  const lowerQuery = query.toLowerCase()
  return items.filter(
    (item) =>
      item.slug.toLowerCase().includes(lowerQuery) || (item.name && item.name.toLowerCase().includes(lowerQuery))
  )
}

/**
 * Hook that manages the channel suggestion state and provides render callbacks.
 * Returns configuration for the ChannelExtension and a render function for the popup.
 */
export function useChannelSuggestion() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId ?? "")

  // Convert streams to channel items
  const channels = useMemo<ChannelItem[]>(() => {
    if (!bootstrap) return []

    return bootstrap.streams
      .filter((stream) => stream.type === "channel" && stream.slug)
      .map((stream) => ({
        id: stream.id,
        slug: stream.slug!,
        name: stream.displayName ?? stream.slug!,
        type: "channel" as const,
      }))
  }, [bootstrap])

  const renderList = useCallback(
    (props: {
      ref: React.RefObject<{ onKeyDown: (event: KeyboardEvent) => boolean } | null>
      items: ChannelItem[]
      clientRect: (() => DOMRect | null) | null
      command: (item: ChannelItem) => void
    }) => <ChannelList ref={props.ref} items={props.items} clientRect={props.clientRect} command={props.command} />,
    []
  )

  const { suggestionConfig, renderSuggestionList } = useSuggestion<ChannelItem>({
    getItems: () => channels,
    filterItems: filterChannels,
    renderList,
  })

  return {
    suggestionConfig,
    renderChannelList: renderSuggestionList,
  }
}
