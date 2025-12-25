import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"

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
