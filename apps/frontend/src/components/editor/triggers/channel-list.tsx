import { forwardRef } from "react"
import type { Placement } from "@floating-ui/react"
import { Hash } from "lucide-react"
import { SuggestionList, type SuggestionListRef } from "./suggestion-list"
import type { ChannelItem } from "./types"

export type ChannelListRef = SuggestionListRef

interface ChannelListProps {
  items: ChannelItem[]
  clientRect: (() => DOMRect | null) | null
  command: (item: ChannelItem) => void
  placement?: Placement
}

function ChannelItemContent({ item }: { item: ChannelItem }) {
  return (
    <>
      <Hash className="h-4 w-4 text-green-600 dark:text-green-400" />
      <div className="flex flex-1 flex-col items-start">
        <span className="font-medium">{item.name ?? item.slug}</span>
        <span className="text-xs text-muted-foreground">
          #{item.slug}
          {item.memberCount !== undefined && ` · ${item.memberCount} members`}
        </span>
      </div>
    </>
  )
}

/**
 * Autocomplete list for #channels.
 * Shows available channels/streams with keyboard navigation.
 */
export const ChannelList = forwardRef<ChannelListRef, ChannelListProps>(function ChannelList(
  { items, clientRect, command, placement },
  ref
) {
  return (
    <SuggestionList
      ref={ref}
      items={items}
      clientRect={clientRect}
      command={command}
      getKey={(item) => item.id}
      ariaLabel="Channel suggestions"
      renderItem={(item) => <ChannelItemContent item={item} />}
      placement={placement}
    />
  )
})
