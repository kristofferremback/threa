import type { NavigateFunction } from "react-router-dom"
import { FileText, Hash, Search } from "lucide-react"
import { toast } from "sonner"

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
  createChannel: (slug: string) => Promise<{ id: string }>
  setMode?: (mode: "stream" | "command" | "search") => void
  requestInput: (request: InputRequest) => void
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
    action: ({ workspaceId, navigate, closeDialog, createChannel, requestInput }) => {
      requestInput({
        icon: Hash,
        placeholder: "Enter channel name...",
        hint: "Press Enter to create, Esc to cancel",
        onSubmit: async (name: string) => {
          const trimmed = name.trim()
          if (!trimmed) return

          const slug = trimmed
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
          if (!slug) return

          try {
            const stream = await createChannel(slug)
            closeDialog()
            navigate(`/w/${workspaceId}/s/${stream.id}`)
          } catch (error) {
            console.error("Failed to create channel:", error)
            toast.error("Failed to create channel")
          }
        },
      })
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
