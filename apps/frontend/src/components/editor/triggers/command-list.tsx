import { forwardRef } from "react"
import { Slash } from "lucide-react"
import { SuggestionList, type SuggestionListRef } from "./suggestion-list"
import type { CommandItem } from "./types"

export type CommandListRef = SuggestionListRef

interface CommandListProps {
  items: CommandItem[]
  clientRect: (() => DOMRect | null) | null
  command: (item: CommandItem) => void
}

function CommandItemContent({ item }: { item: CommandItem }) {
  return (
    <>
      <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
        <Slash className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex flex-1 flex-col items-start">
        <span className="font-medium">/{item.name}</span>
        <span className="text-xs text-muted-foreground">{item.description}</span>
      </div>
    </>
  )
}

/**
 * Autocomplete list for /slash commands.
 * Shows available commands with descriptions and keyboard navigation.
 */
export const CommandList = forwardRef<CommandListRef, CommandListProps>(function CommandList(
  { items, clientRect, command },
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
      width="w-72"
      renderItem={(item) => <CommandItemContent item={item} />}
    />
  )
})
