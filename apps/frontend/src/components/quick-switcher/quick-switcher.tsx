import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Search, Terminal, FileText } from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useWorkspaceBootstrap, useDraftScratchpads, useCreateStream } from "@/hooks"
import { StreamTypes } from "@threa/types"
import { useStreamItems } from "./use-stream-items"
import { useCommandItems } from "./use-command-items"
import { useSearchItems } from "./use-search-items"
import { ItemList } from "./item-list"
import { ModeTabs } from "./mode-tabs"
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
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [inputRequest, setInputRequest] = useState<InputRequest | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [focusedTabIndex, setFocusedTabIndex] = useState<number | null>(null)
  const [showEscapeHint, setShowEscapeHint] = useState(false)

  const mode = deriveMode(query)
  const displayQuery = getDisplayQuery(query, mode)

  const streams = useMemo(() => bootstrap?.streams ?? [], [bootstrap?.streams])

  const inputRef = useRef<HTMLInputElement>(null)

  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const setMode = useCallback((newMode: QuickSwitcherMode) => {
    setQuery(MODE_PREFIXES[newMode])
    setSelectedIndex(0)
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

  // Get items based on current mode
  const streamResult = useStreamItems({
    workspaceId,
    query: displayQuery,
    navigate,
    closeDialog: handleClose,
    streams,
  })

  const commandResult = useCommandItems({
    query: displayQuery,
    commandContext,
  })

  const searchResult = useSearchItems({
    workspaceId,
    query: displayQuery,
    closeDialog: handleClose,
  })

  // Select the current mode's result
  const currentResult = mode === "stream" ? streamResult : mode === "command" ? commandResult : searchResult
  const items = currentResult.items

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [items.length, mode])

  // Reset query and focus input when dialog opens
  useEffect(() => {
    if (open) {
      const prefix = initialMode ? MODE_PREFIXES[initialMode] : ""
      setQuery(prefix)
      setSelectedIndex(0)
      setFocusedTabIndex(null)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [open, initialMode])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("")
      setSelectedIndex(0)
      setInputRequest(null)
      setInputValue("")
      setFocusedTabIndex(null)
      setShowEscapeHint(false)
    }
  }, [open])

  const dialogRef = useRef<HTMLDivElement>(null)

  // Show escape hint after 2 seconds if focus has left the dialog (Vimium scenario)
  useEffect(() => {
    if (!open) return

    const timer = setTimeout(() => {
      const focusInDialog = dialogRef.current?.contains(document.activeElement)
      if (!focusInDialog) {
        setShowEscapeHint(true)
      }
    }, 2000)

    return () => clearTimeout(timer)
  }, [open])

  const focusInput = useCallback(() => {
    setFocusedTabIndex(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [])

  const handleModeChange = useCallback(
    (newMode: QuickSwitcherMode) => {
      if (newMode !== mode) {
        setMode(newMode)
      }
    },
    [mode, setMode]
  )

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Ctrl+[ as vim-style Escape alternative (handled here since onEscapeKeyDown doesn't catch it)
      if (e.ctrlKey && e.key === "[") {
        e.preventDefault()
        if (inputRequest) {
          clearInputRequest()
        } else {
          handleClose()
        }
        return
      }

      if (e.key === "Enter" && inputRequest) {
        e.preventDefault()
        inputRequest.onSubmit(inputValue)
        return
      }
    },
    [inputRequest, inputValue, clearInputRequest, handleClose]
  )

  const ModeIcon = inputRequest?.icon ?? MODE_ICONS[mode]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogRef}
        className="overflow-hidden p-0 shadow-lg !fixed !top-[20%] !translate-y-0"
        onEscapeKeyDown={(e) => {
          // When in inputRequest mode, Escape returns to command list instead of closing
          if (inputRequest) {
            e.preventDefault()
            clearInputRequest()
            requestAnimationFrame(() => {
              inputRef.current?.focus()
            })
          }
        }}
        onKeyDown={(e) => {
          // Global arrow key navigation - works even when focus is on tabs
          if (e.key === "ArrowDown" && !inputRequest) {
            e.preventDefault()
            setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : prev))
          } else if (e.key === "ArrowUp" && !inputRequest) {
            e.preventDefault()
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
          } else if (e.key === "Enter" && !inputRequest && focusedTabIndex === null) {
            // Enter selects item when not focused on tabs
            e.preventDefault()
            items[selectedIndex]?.onSelect()
          }
        }}
      >
        {/* Input area */}
        <div className="flex items-center border-b px-3">
          <ModeIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            ref={inputRef}
            value={inputRequest ? inputValue : query}
            onChange={(e) => {
              if (inputRequest) {
                setInputValue(e.target.value)
              } else {
                setQuery(e.target.value)
                setSelectedIndex(0)
              }
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={inputRequest?.placeholder ?? MODE_PLACEHOLDERS[mode]}
            className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            autoFocus
            aria-label={inputRequest ? "Command input" : "Quick switcher input"}
          />
        </div>

        {/* Mode tabs - only show when not in input request mode */}
        {!inputRequest && (
          <ModeTabs
            currentMode={mode}
            onModeChange={handleModeChange}
            focusedTabIndex={focusedTabIndex}
            onFocusedTabIndexChange={setFocusedTabIndex}
            onTabSelect={focusInput}
          />
        )}

        {/* Hint from input request */}
        {inputRequest && <div className="px-3 py-2 text-xs text-muted-foreground border-b">{inputRequest.hint}</div>}

        {/* Mode-specific header (e.g., search filters) */}
        {!inputRequest && currentResult.header}

        {/* Item list */}
        {!inputRequest && (
          <ItemList
            items={items}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            isLoading={currentResult.isLoading}
            emptyMessage={currentResult.emptyMessage}
          />
        )}

        {/* Escape hint - shown after 2s to help users with Vimium or similar */}
        {showEscapeHint && (
          <div className="px-3 py-1.5 text-xs text-muted-foreground border-t text-center animate-in fade-in duration-500">
            Tip: Use <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Ctrl+[</kbd> or click outside to close
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
