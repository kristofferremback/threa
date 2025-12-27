import { useState, useCallback, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import { useParams } from "react-router-dom"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"
import type { ChannelItem } from "./types"
import { ChannelList, type ChannelListRef } from "./channel-list"
import { useWorkspaceBootstrap } from "@/hooks/use-workspaces"

interface SuggestionState {
  items: ChannelItem[]
  clientRect: (() => DOMRect | null) | null
  command: ((item: ChannelItem) => void) | null
}

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
  const [state, setState] = useState<SuggestionState | null>(null)
  const listRef = useRef<ChannelListRef>(null)

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

  // Use ref to avoid stale closure in TipTap callback
  const channelsRef = useRef(channels)
  channelsRef.current = channels

  // Use stable callback that reads from ref - TipTap captures this at extension creation time
  const getSuggestionItems = useCallback(
    ({ query }: { query: string }) => {
      return filterChannels(channelsRef.current, query)
    },
    [] // Empty deps - callback is stable, reads current value from ref
  )

  const onStart = useCallback((props: SuggestionProps<ChannelItem>) => {
    setState({
      items: props.items,
      clientRect: props.clientRect ?? null,
      command: props.command,
    })
  }, [])

  const onUpdate = useCallback((props: SuggestionProps<ChannelItem>) => {
    setState({
      items: props.items,
      clientRect: props.clientRect ?? null,
      command: props.command,
    })
  }, [])

  const onExit = useCallback(() => {
    setState(null)
  }, [])

  const onKeyDown = useCallback((props: SuggestionKeyDownProps) => {
    if (props.event.key === "Escape") {
      setState(null)
      return true
    }
    return listRef.current?.onKeyDown(props.event) ?? false
  }, [])

  const suggestionConfig = {
    items: getSuggestionItems,
    render: () => ({
      onStart,
      onUpdate,
      onExit,
      onKeyDown,
    }),
  }

  const renderChannelList = useCallback(() => {
    if (!state || !state.command) return null

    return createPortal(
      <ChannelList ref={listRef} items={state.items} clientRect={state.clientRect} command={state.command} />,
      document.body
    )
  }, [state])

  return {
    suggestionConfig,
    renderChannelList,
  }
}
