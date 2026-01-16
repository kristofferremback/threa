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

/** Avatar background and text colors by mention type */
const avatarStyles: Record<Mentionable["type"], string> = {
  user: "bg-[hsl(200_70%_50%/0.15)] text-[hsl(200_70%_50%)]",
  persona: "bg-primary/15 text-primary",
  broadcast: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
}

/** Text color for the slug/type label */
const slugColors: Record<Mentionable["type"], string> = {
  user: "text-[hsl(200_70%_50%)]",
  persona: "text-primary",
  broadcast: "text-orange-600 dark:text-orange-400",
}

function MentionItem({ item }: { item: Mentionable }) {
  return (
    <>
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className={cn("text-xs font-semibold", avatarStyles[item.type])}>
          {item.avatarEmoji ?? item.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-1 flex-col items-start min-w-0">
        <span className="text-[13px] font-medium truncate w-full">
          {item.name}
          {item.isCurrentUser && <span className="text-muted-foreground font-normal"> (me)</span>}
        </span>
        <span className={cn("text-xs truncate w-full", slugColors[item.type])}>
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
      width="w-60"
    />
  )
})
