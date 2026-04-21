import { SmilePlus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { EmojiEntry } from "@threa/types"

interface EmojiQuickBarProps {
  /** Emojis the current user has already reacted with — shown with ring highlight */
  activeEmojis: EmojiEntry[]
  /** Emojis other users have reacted with that the current user hasn't — shown without ring */
  othersEmojis?: EmojiEntry[]
  /** Fresh quick-pick emojis (all message reactions already excluded) */
  quickEmojis: EmojiEntry[]
  onReact: (shortcode: string) => void
  onOpenFullPicker: () => void
  /** "sm" for the desktop hover card, "md" for the mobile action drawer */
  size?: "sm" | "md"
}

const SIZE_CONFIG = {
  sm: { btn: "flex items-center justify-center w-8 h-8 rounded-full transition-colors text-lg", icon: "h-4 w-4" },
  md: { btn: "flex items-center justify-center w-10 h-10 rounded-full transition-colors text-xl", icon: "h-5 w-5" },
}

// Max top-section (mine + others) buttons before collapsing into "+N" overflow
const MAX_ACTIVE_VISIBLE: Record<"sm" | "md", number> = { sm: 4, md: 5 }

export function EmojiQuickBar({
  activeEmojis,
  othersEmojis = [],
  quickEmojis,
  onReact,
  onOpenFullPicker,
  size = "md",
}: EmojiQuickBarProps) {
  const { btn: btnClass, icon: iconClass } = SIZE_CONFIG[size]
  const maxVisible = MAX_ACTIVE_VISIBLE[size]

  // Mine first, then others — truncate the combined total
  const visibleMine = activeEmojis.slice(0, maxVisible)
  const remainingSlots = maxVisible - visibleMine.length
  const visibleOthers = othersEmojis.slice(0, remainingSlots)
  const overflowCount = activeEmojis.length + othersEmojis.length - visibleMine.length - visibleOthers.length

  const hasTopSection = activeEmojis.length > 0 || othersEmojis.length > 0

  const mineButtons = visibleMine.map((entry) => (
    <button
      key={entry.shortcode}
      type="button"
      className={cn(btnClass, "bg-primary/10 ring-1 ring-primary/30 active:bg-primary/20")}
      title={`:${entry.shortcode}:`}
      onClick={() => onReact(entry.shortcode)}
    >
      {entry.emoji}
    </button>
  ))

  const othersButtons = visibleOthers.map((entry) => (
    <button
      key={entry.shortcode}
      type="button"
      className={cn(btnClass, "ring-1 ring-border hover:bg-muted active:bg-muted/80")}
      title={`:${entry.shortcode}:`}
      onClick={() => onReact(entry.shortcode)}
    >
      {entry.emoji}
    </button>
  ))

  const overflowButton = overflowCount > 0 && (
    <button
      type="button"
      className={cn(
        btnClass,
        "bg-primary/10 ring-1 ring-primary/30 active:bg-primary/20 text-xs font-semibold text-primary/80 tabular-nums"
      )}
      aria-label={`${overflowCount} more reactions`}
      onClick={onOpenFullPicker}
    >
      +{overflowCount}
    </button>
  )

  const quickButtons = quickEmojis.map((entry) => (
    <button
      key={entry.shortcode}
      type="button"
      className={cn(btnClass, "hover:bg-muted active:bg-muted/80")}
      title={`:${entry.shortcode}:`}
      onClick={() => onReact(entry.shortcode)}
    >
      {entry.emoji}
    </button>
  ))

  const moreButton = (
    <button
      type="button"
      className={cn(btnClass, "hover:bg-muted active:bg-muted/80 text-muted-foreground")}
      aria-label="More reactions"
      onClick={onOpenFullPicker}
    >
      <SmilePlus className={iconClass} />
    </button>
  )

  if (size === "md" && hasTopSection) {
    return (
      <div className="flex flex-col gap-1 w-full">
        <div className="flex items-center gap-1.5">
          {mineButtons}
          {othersButtons}
          {overflowButton}
        </div>
        <div className="h-px bg-border/60 mx-0.5" />
        <div className="flex items-center gap-1.5">
          {quickButtons}
          {moreButton}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      {hasTopSection && (
        <>
          {mineButtons}
          {othersButtons}
          {overflowButton}
          <div className="w-px self-stretch bg-border mx-0.5" />
        </>
      )}
      {quickButtons}
      {moreButton}
    </div>
  )
}
