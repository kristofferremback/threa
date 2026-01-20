import { forwardRef } from "react"
import type { Placement } from "@floating-ui/react"
import { Terminal } from "lucide-react"
import { SuggestionList, type SuggestionListRef } from "./suggestion-list"
import type { CommandItem } from "./types"

export type CommandListRef = SuggestionListRef

interface CommandListProps {
  items: CommandItem[]
  clientRect: (() => DOMRect | null) | null
  command: (item: CommandItem) => void
  placement?: Placement
}

function CommandItemContent({ item }: { item: CommandItem }) {
  return (
    <>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Terminal className="h-4 w-4" />
      </div>
      <div className="flex flex-1 flex-col items-start min-w-0 overflow-hidden">
        <span className="text-[13px] font-medium truncate w-full">/{item.name}</span>
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
      width="w-[300px]"
      renderItem={(item) => <CommandItemContent item={item} />}
      placement={placement}
    />
  )
})
