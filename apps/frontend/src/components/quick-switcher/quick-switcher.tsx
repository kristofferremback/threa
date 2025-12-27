import { useState, useEffect, useMemo, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { Search, Terminal, FileText } from "lucide-react"
import { CommandDialog, CommandList } from "@/components/ui/command"
import { useWorkspaceBootstrap, useDraftScratchpads, useCreateStream } from "@/hooks"
import { StreamTypes } from "@threa/types"
import { StreamResults } from "./stream-results"
import { CommandResults } from "./command-results"
import { SearchResults } from "./search-results"
import type { CommandContext } from "./commands"

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

  // Reset query when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("")
    }
  }, [open])

  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const setMode = useCallback((newMode: QuickSwitcherMode) => {
    setQuery(MODE_PREFIXES[newMode])
  }, [])

  const handleCreateChannel = useCallback(
    async (slug: string) => {
      const stream = await createStream.mutateAsync({ type: StreamTypes.CHANNEL, slug })
      return stream
    },
    [createStream]
  )

  const commandContext: CommandContext = useMemo(
    () => ({
      workspaceId,
      navigate,
      closeDialog: handleClose,
      createDraftScratchpad: createDraft,
      createChannel: handleCreateChannel,
      setMode,
    }),
    [workspaceId, navigate, handleClose, createDraft, handleCreateChannel, setMode]
  )

  const ModeIcon = MODE_ICONS[mode]

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col">
        {/* Custom input with mode indicator */}
        <div className="flex items-center border-b px-3">
          <ModeIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={MODE_PLACEHOLDERS[mode]}
            className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            autoFocus
          />
        </div>

        {/* Mode-specific content */}
        {mode === "stream" && (
          <CommandList className="max-h-[400px]">
            <StreamResults workspaceId={workspaceId} streams={streams} onSelect={handleClose} />
          </CommandList>
        )}

        {mode === "command" && (
          <CommandList className="max-h-[400px]">
            <CommandResults context={commandContext} />
          </CommandList>
        )}

        {mode === "search" && <SearchResults workspaceId={workspaceId} query={displayQuery} onSelect={handleClose} />}
      </div>
    </CommandDialog>
  )
}
