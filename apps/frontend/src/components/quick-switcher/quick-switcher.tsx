import { useState, useEffect, useMemo, useCallback, type KeyboardEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Search, Terminal, FileText, Hash } from "lucide-react"
import { CommandDialog, CommandList } from "@/components/ui/command"
import { toast } from "sonner"
import { useWorkspaceBootstrap, useDraftScratchpads, useCreateStream } from "@/hooks"
import { StreamTypes } from "@threa/types"
import { StreamResults } from "./stream-results"
import { CommandResults } from "./command-results"
import { SearchResults } from "./search-results"
import type { CommandContext } from "./commands"

export type QuickSwitcherMode = "stream" | "command" | "search"
type PendingAction = "create-channel" | null

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
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [actionInput, setActionInput] = useState("")

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
      setPendingAction(null)
      setActionInput("")
    }
  }, [open])

  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const setMode = useCallback((newMode: QuickSwitcherMode) => {
    setQuery(MODE_PREFIXES[newMode])
  }, [])

  const startCreateChannel = useCallback(() => {
    setPendingAction("create-channel")
    setActionInput("")
  }, [])

  const executeCreateChannel = useCallback(async () => {
    const name = actionInput.trim()
    if (!name) return

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    if (!slug) return

    try {
      const stream = await createStream.mutateAsync({ type: StreamTypes.CHANNEL, slug })
      handleClose()
      navigate(`/w/${workspaceId}/s/${stream.id}`)
    } catch (error) {
      toast.error("Failed to create channel")
    }
  }, [actionInput, createStream, handleClose, navigate, workspaceId])

  const handleActionKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && pendingAction === "create-channel") {
        e.preventDefault()
        executeCreateChannel()
      } else if (e.key === "Escape") {
        e.preventDefault()
        setPendingAction(null)
        setActionInput("")
      }
    },
    [pendingAction, executeCreateChannel]
  )

  const commandContext: CommandContext = useMemo(
    () => ({
      workspaceId,
      navigate,
      closeDialog: handleClose,
      createDraftScratchpad: createDraft,
      startCreateChannel,
      setMode,
    }),
    [workspaceId, navigate, handleClose, createDraft, startCreateChannel, setMode]
  )

  const ModeIcon = pendingAction === "create-channel" ? Hash : MODE_ICONS[mode]

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col">
        {/* Input area */}
        <div className="flex items-center border-b px-3">
          <ModeIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          {pendingAction === "create-channel" ? (
            <input
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
              onKeyDown={handleActionKeyDown}
              placeholder="Enter channel name..."
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              autoFocus
              role="combobox"
              aria-expanded="false"
              aria-label="Channel name input"
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

        {/* Action hint for create-channel */}
        {pendingAction === "create-channel" && (
          <div className="px-3 py-2 text-xs text-muted-foreground border-b">
            Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to create,{" "}
            <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Esc</kbd> to cancel
          </div>
        )}

        {/* Mode-specific content (hidden during pending action) */}
        {!pendingAction && mode === "stream" && (
          <CommandList className="max-h-[400px]">
            <StreamResults workspaceId={workspaceId} streams={streams} onSelect={handleClose} />
          </CommandList>
        )}

        {!pendingAction && mode === "command" && (
          <CommandList className="max-h-[400px]">
            <CommandResults context={commandContext} />
          </CommandList>
        )}

        {!pendingAction && mode === "search" && (
          <SearchResults workspaceId={workspaceId} query={displayQuery} onSelect={handleClose} />
        )}
      </div>
    </CommandDialog>
  )
}
