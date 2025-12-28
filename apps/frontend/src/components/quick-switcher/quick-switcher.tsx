import { useState, useEffect, useMemo, useCallback, type KeyboardEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Search, Terminal, FileText } from "lucide-react"
import { CommandDialog, CommandList } from "@/components/ui/command"
import { useWorkspaceBootstrap, useDraftScratchpads, useCreateStream } from "@/hooks"
import { StreamTypes } from "@threa/types"
import { StreamResults } from "./stream-results"
import { CommandResults } from "./command-results"
import { SearchResults } from "./search-results"
import type { CommandContext, InputRequest } from "./commands"

export type QuickSwitcherMode = "stream" | "command" | "search"

interface QuickSwitcherProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialMode?: QuickSwitcherMode
}

const MODE_PREFIXES: Record<QuickSwitcherMode, string> = {
  stream: "",
  command: ">",
  search: "?",
}

const MODE_ICONS: Record<QuickSwitcherMode, React.ComponentType<{ className?: string }>> = {
  stream: FileText,
  command: Terminal,
  search: Search,
}

const MODE_PLACEHOLDERS: Record<QuickSwitcherMode, string> = {
  stream: "Search streams...",
  command: "Run a command...",
  search: "Search messages...",
}

function deriveMode(query: string): QuickSwitcherMode {
  if (query.startsWith(">")) return "command"
  if (query.startsWith("?")) return "search"
  return "stream"
}

function getDisplayQuery(query: string, mode: QuickSwitcherMode): string {
  if (mode === "command" && query.startsWith(">")) {
    return query.slice(1).trimStart()
  }
  if (mode === "search" && query.startsWith("?")) {
    return query.slice(1).trimStart()
  }
  return query
}

export function QuickSwitcher({ workspaceId, open, onOpenChange, initialMode }: QuickSwitcherProps) {
  const navigate = useNavigate()
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId)
  const { createDraft } = useDraftScratchpads(workspaceId)
  const createStream = useCreateStream(workspaceId)

  const [query, setQuery] = useState("")
  const [inputRequest, setInputRequest] = useState<InputRequest | null>(null)
  const [inputValue, setInputValue] = useState("")

  const mode = deriveMode(query)
  const displayQuery = getDisplayQuery(query, mode)

  const streams = useMemo(() => bootstrap?.streams ?? [], [bootstrap?.streams])

  // Reset query when dialog opens, applying initial mode prefix
  useEffect(() => {
    if (open) {
      const prefix = initialMode ? MODE_PREFIXES[initialMode] : ""
      setQuery(prefix)
    }
  }, [open, initialMode])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("")
      setInputRequest(null)
      setInputValue("")
    }
  }, [open])

  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const setMode = useCallback((newMode: QuickSwitcherMode) => {
    setQuery(MODE_PREFIXES[newMode])
  }, [])

  const requestInput = useCallback((request: InputRequest) => {
    setInputRequest(request)
    setInputValue("")
  }, [])

  const clearInputRequest = useCallback(() => {
    setInputRequest(null)
    setInputValue("")
  }, [])

  const createChannel = useCallback(
    async (slug: string) => {
      return createStream.mutateAsync({ type: StreamTypes.CHANNEL, slug })
    },
    [createStream]
  )

  const handleInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && inputRequest) {
        e.preventDefault()
        inputRequest.onSubmit(inputValue)
      }
    },
    [inputRequest, inputValue]
  )

  const commandContext: CommandContext = useMemo(
    () => ({
      workspaceId,
      navigate,
      closeDialog: handleClose,
      createDraftScratchpad: createDraft,
      createChannel,
      setMode,
      requestInput,
    }),
    [workspaceId, navigate, handleClose, createDraft, createChannel, setMode, requestInput]
  )

  const ModeIcon = inputRequest?.icon ?? MODE_ICONS[mode]

  const handleEscapeKeyDown = useCallback(
    (e: globalThis.KeyboardEvent) => {
      e.preventDefault()
      if (inputRequest) {
        clearInputRequest()
      } else {
        handleClose()
      }
    },
    [inputRequest, clearInputRequest, handleClose]
  )

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} onEscapeKeyDown={handleEscapeKeyDown}>
      <div className="flex flex-col">
        {/* Input area */}
        <div className="flex items-center border-b px-3">
          <ModeIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          {inputRequest ? (
            <input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={inputRequest.placeholder}
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              autoFocus
              role="combobox"
              aria-expanded="false"
              aria-label="Command input"
            />
          ) : (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={MODE_PLACEHOLDERS[mode]}
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-label="Quick switcher input"
            />
          )}
        </div>

        {/* Hint from input request */}
        {inputRequest && <div className="px-3 py-2 text-xs text-muted-foreground border-b">{inputRequest.hint}</div>}

        {/* Mode-specific content (hidden during input request) */}
        {!inputRequest && mode === "stream" && (
          <CommandList className="max-h-[400px]">
            <StreamResults workspaceId={workspaceId} streams={streams} onSelect={handleClose} />
          </CommandList>
        )}

        {!inputRequest && mode === "command" && (
          <CommandList className="max-h-[400px]">
            <CommandResults context={commandContext} />
          </CommandList>
        )}

        {!inputRequest && mode === "search" && (
          <SearchResults workspaceId={workspaceId} query={displayQuery} onSelect={handleClose} />
        )}
      </div>
    </CommandDialog>
  )
}
