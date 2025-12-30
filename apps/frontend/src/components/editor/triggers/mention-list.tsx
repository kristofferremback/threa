import { forwardRef } from "react"
import type { Placement } from "@floating-ui/react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { SuggestionList, type SuggestionListRef } from "./suggestion-list"
import type { Mentionable } from "./types"

export type MentionListRef = SuggestionListRef

interface MentionListProps {
  items: Mentionable[]
  clientRect: (() => DOMRect | null) | null
  command: (item: Mentionable) => void
  placement?: Placement
}

const typeLabels: Record<Mentionable["type"], string> = {
  user: "User",
  persona: "Persona",
  broadcast: "Notify",
}

const typeColors: Record<Mentionable["type"], string> = {
  user: "text-blue-600 dark:text-blue-400",
  persona: "text-primary",
  broadcast: "text-orange-600 dark:text-orange-400",
}

function MentionItem({ item }: { item: Mentionable }) {
  return (
    <>
      <Avatar className="h-6 w-6">
        <AvatarFallback className="text-xs">{item.avatarEmoji ?? item.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex flex-1 flex-col items-start">
        <span className="font-medium">
          {item.name}
          {item.isCurrentUser && <span className="text-muted-foreground"> (me)</span>}
        </span>
        <span className={cn("text-xs", typeColors[item.type])}>
          @{item.slug} · {item.isCurrentUser ? "You" : typeLabels[item.type]}
        </span>
      </div>
    </>
  )
}

/**
 * Autocomplete list for @mentions.
 * Shows users, personas, and broadcast options with keyboard navigation.
 */
export const MentionList = forwardRef<MentionListRef, MentionListProps>(function MentionList(
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
      ariaLabel="Mention suggestions"
      renderItem={(item) => <MentionItem item={item} />}
      placement={placement}
    />
  )
})
