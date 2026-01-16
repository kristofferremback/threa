import { forwardRef } from "react"
import type { Placement } from "@floating-ui/react"
import { Slash } from "lucide-react"
import { cn } from "@/lib/utils"
import { SuggestionList, type SuggestionListRef } from "./suggestion-list"
import type { CommandItem } from "./types"

export type CommandListRef = SuggestionListRef

interface CommandListProps {
  items: CommandItem[]
  clientRect: (() => DOMRect | null) | null
  command: (item: CommandItem) => void
  placement?: Placement
}

/** Icon background and text colors by command category */
const categoryStyles: Record<string, string> = {
  backend: "bg-[hsl(280_60%_55%/0.15)] text-[hsl(280_60%_55%)]",
  frontend: "bg-[hsl(200_70%_50%/0.15)] text-[hsl(200_70%_50%)]",
  ai: "bg-primary/15 text-primary",
  default: "bg-muted text-muted-foreground",
}

function CommandItemContent({ item }: { item: CommandItem }) {
  const iconStyle = categoryStyles[item.category ?? "default"] ?? categoryStyles.default

  return (
    <>
      <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", iconStyle)}>
        <Slash className="h-4 w-4" />
      </div>
      <div className="flex flex-1 flex-col items-start min-w-0">
        <span className="text-[13px] font-medium">/{item.name}</span>
        <span className="text-xs text-muted-foreground truncate w-full">{item.description}</span>
      </div>
    </>
  )
}

/**
 * Autocomplete list for /slash commands.
 * Shows available commands with descriptions and keyboard navigation.
 */
export const CommandList = forwardRef<CommandListRef, CommandListProps>(function CommandList(
  { items, clientRect, command, placement },
  ref
) {
  return (
    <SuggestionList
      ref={ref}
      items={items}
      clientRect={clientRect}
      command={command}
      getKey={(item) => item.name}
      ariaLabel="Slash command suggestions"
      width="w-[280px]"
      renderItem={(item) => <CommandItemContent item={item} />}
      placement={placement}
    />
  )
})
