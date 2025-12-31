import { useCallback, useMemo } from "react"
import { useParams } from "react-router-dom"
import type { ChannelItem } from "./types"
import { ChannelList } from "./channel-list"
import { useWorkspaceBootstrap } from "@/hooks/use-workspaces"
import { useSuggestion } from "./use-suggestion"

/**
 * Filter channels by query string.
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
 * Hook for `in:#` filter suggestions in search context.
 * Shows channels when typing `in:#`.
 */
export function useInChannelFilterSuggestion() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId ?? "")

  const channels = useMemo<ChannelItem[]>(() => {
    if (!bootstrap) return []
    return bootstrap.streams
      .filter((stream) => stream.slug) // Only streams with slugs (channels)
      .map((stream) => ({
        id: stream.id,
        slug: stream.slug!,
        name: stream.displayName ?? stream.slug!,
        type: (stream.type === "scratchpad" ? "scratchpad" : "channel") as "channel" | "scratchpad",
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

  const { suggestionConfig, renderSuggestionList, isActive, close } = useSuggestion<ChannelItem>({
    getItems: () => channels,
    filterItems: filterChannels,
    renderList,
  })

  return {
    suggestionConfig,
    renderInChannelFilterList: renderSuggestionList,
    isActive,
    close,
  }
}
