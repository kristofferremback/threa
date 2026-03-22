import { useMemo, useCallback } from "react"
import { Plus, X } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useActors, useMessageReactions } from "@/hooks"
import { useIsMobile } from "@/hooks/use-mobile"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
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
  const { toggleReaction, toggleByEmoji } = useMessageReactions(workspaceId, messageId)

  const sortedReactions = useMemo(() => {
    return Object.entries(reactions)
      .filter(([, users]) => users.length > 0)
      .sort((a, b) => b[1].length - a[1].length)
  }, [reactions])

  const visibleReactions = sortedReactions.slice(0, MAX_VISIBLE_REACTIONS)
  const overflowCount = sortedReactions.length - MAX_VISIBLE_REACTIONS

  const activeShortcodes = useMemo(() => {
    if (!currentUserId) return new Set<string>()
    const active = new Set<string>()
    for (const [shortcode, userIds] of Object.entries(reactions)) {
      if (userIds.includes(currentUserId)) {
        // Strip colons: reactions dict keys are ":laughing:" but EmojiEntry.shortcode is "laughing"
        active.add(shortcode.replace(/^:|:$/g, ""))
      }
    }
    return active
  }, [currentUserId, reactions])

  const handleToggleReaction = useCallback(
    (shortcode: string) => toggleReaction(shortcode, reactions, currentUserId),
    [toggleReaction, reactions, currentUserId]
  )

  if (sortedReactions.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5">
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
            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted/80 hover:border-border transition-all"
          >
            +{overflowCount}
          </button>
        </AllReactionsPopover>
      )}

      <ReactionEmojiPicker
        workspaceId={workspaceId}
        onSelect={(emoji) => toggleByEmoji(emoji, reactions, currentUserId)}
        activeShortcodes={activeShortcodes}
        trigger={
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-dashed border-border/50 h-[22px] w-[22px] text-muted-foreground/60 hover:bg-muted/80 hover:text-foreground hover:border-border transition-all"
            aria-label="Add reaction"
          >
            <Plus className="h-2.5 w-2.5" />
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
        "group/pill relative inline-flex items-center gap-1 rounded-full border pl-1.5 pr-2 py-0.5 text-xs transition-all",
        hasReacted
          ? "border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/[0.14] hover:border-primary/40"
          : "border-border/60 text-muted-foreground hover:bg-muted/80 hover:border-border"
      )}
      onClick={onToggle}
    >
      {/* Emoji — on desktop, fades to X icon on hover when user has reacted */}
      <span className="relative text-sm leading-none w-4 h-4 flex items-center justify-center">
        <span className={cn("transition-opacity", hasReacted && !isMobile && "group-hover/pill:opacity-0")}>
          {emoji}
        </span>
        {hasReacted && !isMobile && (
          <X className="absolute inset-0 h-4 w-4 opacity-0 group-hover/pill:opacity-100 transition-opacity text-primary/70" />
        )}
      </span>
      <span className={cn("tabular-nums", hasReacted && "font-medium")}>{userIds.length}</span>
    </button>
  )

  if (isMobile) {
    return pill
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[200px]">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  )
}
