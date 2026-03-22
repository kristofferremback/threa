import { useMemo, useCallback } from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useActors } from "@/hooks"
import { useIsMobile } from "@/hooks/use-mobile"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { messagesApi } from "@/api/messages"
import { cn } from "@/lib/utils"
import { ReactionEmojiPicker } from "./reaction-emoji-picker"
import { AllReactionsPopover } from "./all-reactions-popover"

const MAX_VISIBLE_REACTIONS = 5

interface MessageReactionsProps {
  reactions: Record<string, string[]>
  workspaceId: string
  messageId: string
  currentUserId: string | null
}

export function MessageReactions({ reactions, workspaceId, messageId, currentUserId }: MessageReactionsProps) {
  const { toEmoji } = useWorkspaceEmoji(workspaceId)
  const isMobile = useIsMobile()

  const sortedReactions = useMemo(() => {
    return Object.entries(reactions)
      .filter(([, users]) => users.length > 0)
      .sort((a, b) => b[1].length - a[1].length)
  }, [reactions])

  const visibleReactions = sortedReactions.slice(0, MAX_VISIBLE_REACTIONS)
  const overflowCount = sortedReactions.length - MAX_VISIBLE_REACTIONS

  const handleToggleReaction = useCallback(
    async (shortcode: string) => {
      if (!currentUserId) return
      const userIds = reactions[shortcode] ?? []
      const hasReacted = userIds.includes(currentUserId)
      const emoji = toEmoji(shortcode)
      if (!emoji) {
        toast.error("Could not resolve emoji")
        return
      }
      try {
        if (hasReacted) {
          await messagesApi.removeReaction(workspaceId, messageId, emoji)
        } else {
          await messagesApi.addReaction(workspaceId, messageId, emoji)
        }
      } catch {
        toast.error("Failed to update reaction")
      }
    },
    [workspaceId, messageId, currentUserId, reactions, toEmoji]
  )

  const handleAddReaction = useCallback(
    async (emoji: string) => {
      try {
        await messagesApi.addReaction(workspaceId, messageId, emoji)
      } catch {
        toast.error("Failed to add reaction")
      }
    },
    [workspaceId, messageId]
  )

  if (sortedReactions.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {visibleReactions.map(([shortcode, userIds]) => (
        <ReactionPill
          key={shortcode}
          emoji={toEmoji(shortcode) ?? shortcode}
          userIds={userIds}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          isMobile={isMobile}
          onToggle={() => handleToggleReaction(shortcode)}
        />
      ))}

      {overflowCount > 0 && (
        <AllReactionsPopover reactions={reactions} workspaceId={workspaceId}>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
          >
            +{overflowCount} more
          </button>
        </AllReactionsPopover>
      )}

      <ReactionEmojiPicker
        workspaceId={workspaceId}
        onSelect={handleAddReaction}
        trigger={
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-dashed h-6 w-6 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Add reaction"
          >
            <Plus className="h-3 w-3" />
          </button>
        }
      />
    </div>
  )
}

interface ReactionPillProps {
  emoji: string
  userIds: string[]
  workspaceId: string
  currentUserId: string | null
  isMobile: boolean
  onToggle: () => void
}

function ReactionPill({ emoji, userIds, workspaceId, currentUserId, isMobile, onToggle }: ReactionPillProps) {
  const { getActorName } = useActors(workspaceId)
  const hasReacted = currentUserId ? userIds.includes(currentUserId) : false

  const tooltipText = useMemo(() => {
    const names = userIds.map((id) => (id === currentUserId ? "You" : getActorName(id, "user")))
    if (names.length <= 3) return names.join(", ")
    return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
  }, [userIds, currentUserId, getActorName])

  const pill = (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
        hasReacted
          ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
          : "text-muted-foreground hover:bg-muted"
      )}
      onClick={onToggle}
    >
      <span className="text-sm leading-none">{emoji}</span>
      <span>{userIds.length}</span>
    </button>
  )

  if (isMobile) {
    return pill
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  )
}
