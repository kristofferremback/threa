import type { NavigateFunction } from "react-router-dom"
import { FileText, Hash, Search, FileEdit, Settings } from "lucide-react"
import { toast } from "sonner"
import type { SettingsTab } from "@threa/types"

/**
 * Commands can request an input prompt via this interface.
 * The QuickSwitcher will render this generically.
 */
export interface InputRequest {
  icon: React.ComponentType<{ className?: string }>
  placeholder: string
  hint: string
  onSubmit: (value: string) => Promise<void>
}

export interface CommandContext {
  workspaceId: string
  navigate: NavigateFunction
  closeDialog: () => void
  createDraftScratchpad: (companionMode: "on" | "off") => Promise<string>
  openCreateChannel: () => void
  setMode?: (mode: "stream" | "command" | "search") => void
  requestInput: (request: InputRequest) => void
  openSettings: (tab?: SettingsTab) => void
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
        console.error("Failed to create scratchpad:", error)
        toast.error("Failed to create scratchpad")
      }
    },
  },
  {
    id: "new-channel",
    label: "New Channel",
    icon: Hash,
    keywords: ["create", "add"],
    action: ({ closeDialog, openCreateChannel }) => {
      closeDialog()
      openCreateChannel()
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
  {
    id: "view-drafts",
    label: "View Drafts",
    icon: FileEdit,
    keywords: ["draft", "unsent", "pending"],
    action: ({ workspaceId, navigate, closeDialog }) => {
      closeDialog()
      navigate(`/w/${workspaceId}/drafts`)
    },
  },
  {
    id: "open-settings",
    label: "Open Settings",
    icon: Settings,
    keywords: ["preferences", "config", "options", "theme", "appearance"],
    action: ({ closeDialog, openSettings }) => {
      closeDialog()
      openSettings()
    },
  },
]
