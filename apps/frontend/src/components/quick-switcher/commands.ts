import type { NavigateFunction } from "react-router-dom"
import { FileText, Hash, Search } from "lucide-react"

export interface CommandContext {
  workspaceId: string
  navigate: NavigateFunction
  closeDialog: () => void
  createDraftScratchpad: (companionMode: "on" | "off") => Promise<string>
  createChannel: (slug: string) => Promise<{ id: string }>
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
      const draftId = await createDraftScratchpad("on")
      closeDialog()
      navigate(`/w/${workspaceId}/s/${draftId}`)
    },
  },
  {
    id: "new-channel",
    label: "New Channel",
    icon: Hash,
    keywords: ["create", "add"],
    action: async ({ workspaceId, navigate, closeDialog, createChannel }) => {
      const name = prompt("Channel name:")
      if (!name?.trim()) return

      const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
      if (!slug) return

      const stream = await createChannel(slug)
      closeDialog()
      navigate(`/w/${workspaceId}/s/${stream.id}`)
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
