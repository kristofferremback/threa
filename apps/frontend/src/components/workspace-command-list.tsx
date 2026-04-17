import { useMemo, type ReactNode } from "react"
import { useWorkspaceMetadata } from "@/stores/workspace-store"
import { CommandListProvider } from "@/lib/markdown/command-list-context"

interface WorkspaceCommandListProviderProps {
  workspaceId: string
  children: ReactNode
}

/**
 * Provides the registered slash command names for rendering, so "/foo" in
 * message text is only styled as a command chip when `foo` is a real command.
 */
export function WorkspaceCommandListProvider({ workspaceId, children }: WorkspaceCommandListProviderProps) {
  const metadata = useWorkspaceMetadata(workspaceId)
  const commandNames = useMemo(() => metadata?.commands?.map((c) => c.name) ?? [], [metadata?.commands])
  return <CommandListProvider commandNames={commandNames}>{children}</CommandListProvider>
}
