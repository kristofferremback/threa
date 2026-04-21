import { SmilePlus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { EmojiEntry } from "@threa/types"

interface EmojiQuickBarProps {
  quickEmojis: EmojiEntry[]
  activeShortcodes: Set<string>
  onReact: (shortcode: string) => void
  onOpenFullPicker: () => void
  /** "sm" for the desktop hover card, "md" for the mobile action drawer */
  size?: "sm" | "md"
}

const SIZE_CONFIG = {
  sm: { btn: "flex items-center justify-center w-8 h-8 rounded-full transition-colors text-lg", icon: "h-4 w-4" },
  md: { btn: "flex items-center justify-center w-10 h-10 rounded-full transition-colors text-xl", icon: "h-5 w-5" },
}

export function EmojiQuickBar({
  quickEmojis,
  activeShortcodes,
  onReact,
  onOpenFullPicker,
  size = "md",
}: EmojiQuickBarProps) {
  const { btn: btnClass, icon: iconClass } = SIZE_CONFIG[size]

  return (
    <div className="flex items-center gap-1.5">
      {quickEmojis.map((entry) => {
        const isActive = activeShortcodes.has(entry.shortcode)
        return (
          <button
            key={entry.shortcode}
            type="button"
            className={cn(
              btnClass,
              isActive ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted active:bg-muted/80"
            )}
            title={`:${entry.shortcode}:`}
            onClick={() => onReact(entry.shortcode)}
          >
            {entry.emoji}
          </button>
        )
      })}
      <button
        type="button"
        className={cn(btnClass, "hover:bg-muted active:bg-muted/80 text-muted-foreground")}
        aria-label="More reactions"
        onClick={onOpenFullPicker}
      >
        <SmilePlus className={iconClass} />
      </button>
    </div>
  )
}
