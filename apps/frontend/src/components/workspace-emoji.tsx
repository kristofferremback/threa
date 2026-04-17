import { useMemo, type ReactNode } from "react"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { useWorkspaceMetadata } from "@/stores/workspace-store"
import { EmojiProvider } from "@/lib/markdown/emoji-context"
import { CommandListProvider } from "@/lib/markdown/command-list-context"

interface WorkspaceEmojiProps {
  workspaceId: string
  shortcode: string
  fallback?: string
}

/**
 * Renders an emoji from a shortcode, resolving from the workspace emoji cache.
 * Falls back to the shortcode itself if not found.
 */
export function WorkspaceEmoji({ workspaceId, shortcode, fallback }: WorkspaceEmojiProps) {
  const { toEmoji } = useWorkspaceEmoji(workspaceId)
  const emoji = toEmoji(shortcode)
  return <>{emoji ?? fallback ?? shortcode}</>
}

interface WorkspaceEmojiProviderProps {
  workspaceId: string
  children: ReactNode
}

/**
 * Provides emoji lookup context to children using workspace emoji data.
 * Wrap message lists and other content that displays :shortcode: emojis.
 */
export function WorkspaceEmojiProvider({ workspaceId, children }: WorkspaceEmojiProviderProps) {
  const { emojis } = useWorkspaceEmoji(workspaceId)
  return <EmojiProvider emojis={emojis}>{children}</EmojiProvider>
}

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
