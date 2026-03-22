import { useCallback } from "react"
import { toast } from "sonner"
import { messagesApi } from "@/api/messages"
import { useWorkspaceEmoji } from "./use-workspace-emoji"

interface UseMessageReactionsResult {
  /** Add a reaction (emoji character, e.g. "👍") */
  addReaction: (emoji: string) => Promise<void>
  /** Remove a reaction (emoji character) */
  removeReaction: (emoji: string) => Promise<void>
  /** Toggle: remove if user already reacted with this shortcode, add otherwise.
   *  Requires the current reactions dict and userId to determine direction. */
  toggleReaction: (
    shortcode: string,
    reactions: Record<string, string[]>,
    currentUserId: string | null
  ) => Promise<void>
}

export function useMessageReactions(workspaceId: string, messageId: string): UseMessageReactionsResult {
  const { toEmoji } = useWorkspaceEmoji(workspaceId)

  const addReaction = useCallback(
    async (emoji: string) => {
      try {
        await messagesApi.addReaction(workspaceId, messageId, emoji)
      } catch {
        toast.error("Failed to add reaction")
      }
    },
    [workspaceId, messageId]
  )

  const removeReaction = useCallback(
    async (emoji: string) => {
      try {
        await messagesApi.removeReaction(workspaceId, messageId, emoji)
      } catch {
        toast.error("Failed to update reaction")
      }
    },
    [workspaceId, messageId]
  )

  const toggleReaction = useCallback(
    async (shortcode: string, reactions: Record<string, string[]>, currentUserId: string | null) => {
      if (!currentUserId) return
      const emoji = toEmoji(shortcode)
      if (!emoji) {
        toast.error("Could not resolve emoji")
        return
      }
      const userIds = reactions[shortcode] ?? []
      const hasReacted = userIds.includes(currentUserId)
      if (hasReacted) {
        await removeReaction(emoji)
      } else {
        await addReaction(emoji)
      }
    },
    [toEmoji, addReaction, removeReaction]
  )

  return { addReaction, removeReaction, toggleReaction }
}
