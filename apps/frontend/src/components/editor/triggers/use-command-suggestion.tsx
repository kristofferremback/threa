import { useCallback, useMemo } from "react"
import { useParams } from "react-router-dom"
import { StreamTypes, DISCUSS_WITH_ARIADNE_COMMAND } from "@threa/types"
import type { CommandItem } from "./types"
import { CommandList } from "./command-list"
import { useWorkspaceMetadata, useWorkspaceStreams } from "@/stores/workspace-store"
import { useSuggestion } from "./use-suggestion"
import { useDiscussWithAriadne } from "@/hooks/use-discuss-with-ariadne"

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

function isInviteAllowed(streamId: string | undefined, streams: import("@/db").CachedStream[]): boolean {
  if (!streamId) return false
  const stream = streams.find((s) => s.id === streamId)
  if (!stream) return false
  if (stream.type === StreamTypes.CHANNEL) return true
  if (stream.type === StreamTypes.THREAD && stream.rootStreamId) {
    const rootStream = streams.find((s) => s.id === stream.rootStreamId)
    return rootStream?.type === StreamTypes.CHANNEL
  }
  return false
}

/**
 * Hook that manages the command suggestion state and provides render callbacks.
 * Returns configuration for the CommandExtension and a render function for the popup.
 */
export function useCommandSuggestion() {
  const { workspaceId, streamId } = useParams<{ workspaceId: string; streamId: string }>()
  const metadata = useWorkspaceMetadata(workspaceId)
  const streams = useWorkspaceStreams(workspaceId)

  // Client-action handlers. Each clientActionId maps to a function that takes
  // the current stream context. Declared here so the dispatch path in the
  // render callback stays synchronous + simple.
  const startDiscussWithAriadne = useDiscussWithAriadne(workspaceId ?? "")

  const commands = useMemo<CommandItem[]>(() => {
    if (!metadata?.commands) return []
    const inviteAllowed = isInviteAllowed(streamId, streams)
    return metadata.commands
      .filter((cmd) => {
        if (cmd.name === "invite") return inviteAllowed
        // Gate discuss-with-ariadne on there being a source stream to reference.
        if (cmd.clientActionId === DISCUSS_WITH_ARIADNE_COMMAND) return !!streamId
        return true
      })
      .map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        clientActionId: cmd.clientActionId,
      }))
  }, [metadata?.commands, streamId, streams])

  const renderList = useCallback(
    (props: {
      ref: React.RefObject<{ onKeyDown: (event: KeyboardEvent) => boolean } | null>
      items: CommandItem[]
      clientRect: (() => DOMRect | null) | null
      command: (item: CommandItem) => void
    }) => {
      // Wrap the TipTap `command` callback so client-action commands take a
      // local-only path (fire the handler, don't insert a `/command` node
      // that'd otherwise be sent to the backend command endpoint).
      const onPick = (item: CommandItem) => {
        if (item.clientActionId === DISCUSS_WITH_ARIADNE_COMMAND) {
          if (streamId && workspaceId) {
            void startDiscussWithAriadne({ sourceStreamId: streamId })
          }
          return
        }
        props.command(item)
      }
      return <CommandList ref={props.ref} items={props.items} clientRect={props.clientRect} command={onPick} />
    },
    [startDiscussWithAriadne, streamId, workspaceId]
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
