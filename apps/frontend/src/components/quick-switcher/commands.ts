import type { NavigateFunction } from "react-router-dom"
import { FileText, Hash, Search } from "lucide-react"
import { toast } from "sonner"

export interface CommandContext {
  workspaceId: string
  navigate: NavigateFunction
  closeDialog: () => void
  createDraftScratchpad: (companionMode: "on" | "off") => Promise<string>
  startCreateChannel: () => void
  setMode?: (mode: "stream" | "command" | "search") => void
}

export interface Command {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  keywords?: string[]
  action: (context: CommandContext) => void | Promise<void>
}

export const commands: Command[] = [
  {
    id: "new-scratchpad",
    label: "New Scratchpad",
    icon: FileText,
    keywords: ["create", "note", "draft"],
    action: async ({ workspaceId, navigate, closeDialog, createDraftScratchpad }) => {
      try {
        const draftId = await createDraftScratchpad("on")
        closeDialog()
        navigate(`/w/${workspaceId}/s/${draftId}`)
      } catch (error) {
        toast.error("Failed to create scratchpad")
      }
    },
  },
  {
    id: "new-channel",
    label: "New Channel",
    icon: Hash,
    keywords: ["create", "add"],
    action: ({ startCreateChannel }) => {
      startCreateChannel()
    },
  },
  {
    id: "search",
    label: "Search messages",
    icon: Search,
    keywords: ["find", "query"],
    action: ({ setMode }) => {
      setMode?.("search")
    },
  },
]
