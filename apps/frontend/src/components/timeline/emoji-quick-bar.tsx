import { SmilePlus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { EmojiEntry } from "@threa/types"

interface EmojiQuickBarProps {
  /** Emojis the user has already reacted with on this message — shown above the separator */
  activeEmojis: EmojiEntry[]
  /** Fresh quick-pick emojis (active ones already excluded) */
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

// Max active-reaction buttons to show before collapsing into "+N" overflow
const MAX_ACTIVE_VISIBLE: Record<"sm" | "md", number> = { sm: 4, md: 5 }

export function EmojiQuickBar({
  activeEmojis,
  quickEmojis,
  onReact,
  onOpenFullPicker,
  size = "md",
}: EmojiQuickBarProps) {
  const { btn: btnClass, icon: iconClass } = SIZE_CONFIG[size]
  const maxVisible = MAX_ACTIVE_VISIBLE[size]

  const visibleActive = activeEmojis.slice(0, maxVisible)
  const overflowCount = activeEmojis.length - visibleActive.length

  const activeButtons = visibleActive.map((entry) => (
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

  if (size === "md" && activeEmojis.length > 0) {
    return (
      <div className="flex flex-col gap-1 w-full">
        <div className="flex items-center gap-1.5">
          {activeButtons}
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
      {activeEmojis.length > 0 && (
        <>
          {activeButtons}
          {overflowButton}
          <div className="w-px self-stretch bg-border mx-0.5" />
        </>
      )}
      {quickButtons}
      {moreButton}
    </div>
  )
}
