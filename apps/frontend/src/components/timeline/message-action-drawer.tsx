import { useCallback, useMemo } from "react"
import { Link } from "react-router-dom"
import { SmilePlus } from "lucide-react"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { useMessageReactions } from "@/hooks/use-message-reactions"
import { cn } from "@/lib/utils"
import { type MessageActionContext, type MessageAction, getVisibleActions } from "./message-actions"
import { ReactionEmojiPicker } from "./reaction-emoji-picker"

const QUICK_REACTION_COUNT = 6

const DEFAULT_QUICK_EMOJIS = ["+1", "heart", "joy", "open_mouth", "cry", "fire"]

interface MessageActionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: MessageActionContext
  /** Author display name for the message preview */
  authorName: string
}

export function MessageActionDrawer({ open, onOpenChange, context, authorName }: MessageActionDrawerProps) {
  const actions = getVisibleActions(context)
  const { emojis, emojiWeights } = useWorkspaceEmoji(context.workspaceId ?? "")
  const { toggleReaction, toggleByEmoji } = useMessageReactions(context.workspaceId ?? "", context.messageId ?? "")

  const quickEmojis = useMemo(() => {
    if (!emojis.length) return []

    // Sort by weight descending, take top N
    const weighted = emojis
      .filter((e) => (emojiWeights[e.shortcode] ?? 0) > 0)
      .sort((a, b) => (emojiWeights[b.shortcode] ?? 0) - (emojiWeights[a.shortcode] ?? 0))
      .slice(0, QUICK_REACTION_COUNT)

    if (weighted.length >= QUICK_REACTION_COUNT) return weighted

    // Fill with defaults
    const usedShortcodes = new Set(weighted.map((e) => e.shortcode))
    const emojiMap = new Map(emojis.map((e) => [e.shortcode, e]))
    for (const shortcode of DEFAULT_QUICK_EMOJIS) {
      if (weighted.length >= QUICK_REACTION_COUNT) break
      const entry = emojiMap.get(shortcode)
      if (entry && !usedShortcodes.has(shortcode)) {
        weighted.push(entry)
        usedShortcodes.add(shortcode)
      }
    }
    return weighted
  }, [emojis, emojiWeights])

  const activeShortcodes = useMemo(() => {
    if (!context.currentUserId || !context.reactions) return new Set<string>()
    const active = new Set<string>()
    for (const [shortcode, userIds] of Object.entries(context.reactions)) {
      if (userIds.includes(context.currentUserId)) {
        active.add(shortcode.replace(/^:|:$/g, ""))
      }
    }
    return active
  }, [context.currentUserId, context.reactions])

  // Quick-react toggles: removes if user already reacted, adds otherwise
  const handleQuickReact = useCallback(
    (shortcode: string) => {
      onOpenChange(false)
      toggleReaction(shortcode, context.reactions ?? {}, context.currentUserId ?? null)
    },
    [onOpenChange, toggleReaction, context.reactions, context.currentUserId]
  )

  // Full picker toggles: removes if user already reacted with this emoji
  const handlePickerReact = useCallback(
    (emoji: string) => {
      onOpenChange(false)
      toggleByEmoji(emoji, context.reactions ?? {}, context.currentUserId ?? null)
    },
    [onOpenChange, toggleByEmoji, context.reactions, context.currentUserId]
  )

  const handleAction = useCallback(
    (action: MessageAction) => {
      onOpenChange(false)
      action.action?.(context)
    },
    [context, onOpenChange]
  )

  const handleSubAction = useCallback(
    (sub: { action: (ctx: MessageActionContext) => void | Promise<void> }) => {
      onOpenChange(false)
      sub.action(context)
    },
    [context, onOpenChange]
  )

  if (!open && actions.length === 0) return null

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85dvh]">
        {/* Accessible title (visually hidden) */}
        <DrawerTitle className="sr-only">Message actions</DrawerTitle>

        {/* Message preview */}
        <div className="px-4 pt-1 pb-3">
          <div className="rounded-xl bg-muted/60 px-3.5 py-2.5">
            <p className="text-[13px] font-medium text-muted-foreground mb-0.5">{authorName}</p>
            <div className="text-sm text-foreground/80 line-clamp-2 leading-snug">
              <MarkdownContent content={context.contentMarkdown} />
            </div>
          </div>
        </div>

        {/* Quick reactions row + full picker button */}
        {quickEmojis.length > 0 && context.onReact && (
          <div className="flex justify-center gap-2 px-4 pb-3">
            {quickEmojis.map((entry) => (
              <button
                key={entry.shortcode}
                type="button"
                className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted active:bg-muted/80 transition-colors text-xl"
                title={`:${entry.shortcode}:`}
                onClick={() => handleQuickReact(entry.shortcode)}
              >
                {entry.emoji}
              </button>
            ))}
            <ReactionEmojiPicker
              workspaceId={context.workspaceId ?? ""}
              onSelect={(emoji) => handlePickerReact(emoji)}
              activeShortcodes={activeShortcodes}
              trigger={
                <button
                  type="button"
                  className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted active:bg-muted/80 transition-colors text-muted-foreground"
                  aria-label="More reactions"
                  onClick={() => onOpenChange(false)}
                >
                  <SmilePlus className="h-5 w-5" />
                </button>
              }
            />
          </div>
        )}

        {/* Action list */}
        <div className="px-2 pb-[max(12px,env(safe-area-inset-bottom))]">
          {actions.map((action) => {
            // Flatten sub-actions into separate rows (no nested menus on mobile)
            if (action.subActions && action.subActions.length > 0) {
              return (
                <div key={action.id}>
                  {action.separatorBefore && <Divider />}
                  {action.subActions.map((sub) => {
                    const SubIcon = sub.icon
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm active:bg-muted/80 transition-colors"
                        onClick={() => handleSubAction(sub)}
                      >
                        <SubIcon className="h-[18px] w-[18px] text-muted-foreground shrink-0" />
                        <span>{sub.label}</span>
                      </button>
                    )
                  })}
                </div>
              )
            }

            const Icon = action.icon
            const isDestructive = action.variant === "destructive"
            const href = action.getHref?.(context)

            const rowClassName = cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
              isDestructive ? "text-destructive active:bg-destructive/10" : "active:bg-muted/80"
            )
            const iconEl = (
              <Icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0",
                  isDestructive ? "text-destructive" : "text-muted-foreground"
                )}
              />
            )

            return (
              <div key={action.id}>
                {action.separatorBefore && <Divider />}
                {href ? (
                  <Link to={href} className={rowClassName} onClick={() => onOpenChange(false)}>
                    {iconEl}
                    <span>{action.label}</span>
                  </Link>
                ) : (
                  <button type="button" className={rowClassName} onClick={() => handleAction(action)}>
                    {iconEl}
                    <span>{action.label}</span>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function Divider() {
  return <Separator className="mx-3 my-1 bg-border/50" />
}
