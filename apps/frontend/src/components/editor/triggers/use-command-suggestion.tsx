import { useCallback, useMemo } from "react"
import { useParams } from "react-router-dom"
import type { CommandItem } from "./types"
import { CommandList } from "./command-list"
import { useWorkspaceMetadata } from "@/stores/workspace-store"
import { useSuggestion } from "./use-suggestion"

/**
 * Filter commands by query string.
 * Matches against name and description, case-insensitive.
 */
function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  if (!query) return items

  const lowerQuery = query.toLowerCase()
  return items.filter(
    (item) => item.name.toLowerCase().includes(lowerQuery) || item.description.toLowerCase().includes(lowerQuery)
  )
}

/**
 * Hook that manages the command suggestion state and provides render callbacks.
 * Returns configuration for the CommandExtension and a render function for the popup.
 */
export function useCommandSuggestion() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const metadata = useWorkspaceMetadata(workspaceId)

  const commands = useMemo<CommandItem[]>(() => {
    if (!metadata?.commands) return []
    return metadata.commands.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }))
  }, [metadata?.commands])

  const renderList = useCallback(
    (props: {
      ref: React.RefObject<{ onKeyDown: (event: KeyboardEvent) => boolean } | null>
      items: CommandItem[]
      clientRect: (() => DOMRect | null) | null
      command: (item: CommandItem) => void
    }) => <CommandList ref={props.ref} items={props.items} clientRect={props.clientRect} command={props.command} />,
    []
  )

  const { suggestionConfig, renderSuggestionList, isActive } = useSuggestion<CommandItem>({
    extensionName: "slashCommand",
    getItems: () => commands,
    filterItems: filterCommands,
    renderList,
  })

  return {
    suggestionConfig,
    renderCommandList: renderSuggestionList,
    isActive,
  }
}
