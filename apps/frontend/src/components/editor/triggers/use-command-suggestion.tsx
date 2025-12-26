import { useState, useCallback, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import { useParams } from "react-router-dom"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"
import type { CommandItem } from "./types"
import { CommandList, type CommandListRef } from "./command-list"
import { useWorkspaceBootstrap } from "@/hooks/use-workspaces"

interface SuggestionState {
  items: CommandItem[]
  clientRect: (() => DOMRect | null) | null
  command: ((item: CommandItem) => void) | null
}

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
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId ?? "")
  const [state, setState] = useState<SuggestionState | null>(null)
  const listRef = useRef<CommandListRef>(null)

  // Get commands from bootstrap
  const commands = useMemo<CommandItem[]>(() => {
    if (!bootstrap) return []

    return bootstrap.commands.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }))
  }, [bootstrap])

  const getSuggestionItems = useCallback(
    ({ query }: { query: string }) => {
      return filterCommands(commands, query)
    },
    [commands]
  )

  const onStart = useCallback((props: SuggestionProps<CommandItem>) => {
    setState({
      items: props.items,
      clientRect: props.clientRect ?? null,
      command: props.command,
    })
  }, [])

  const onUpdate = useCallback((props: SuggestionProps<CommandItem>) => {
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

  const renderCommandList = useCallback(() => {
    if (!state || !state.command) return null

    return createPortal(
      <CommandList ref={listRef} items={state.items} clientRect={state.clientRect} command={state.command} />,
      document.body
    )
  }, [state])

  return {
    suggestionConfig,
    renderCommandList,
  }
}
