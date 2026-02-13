import { cn } from "@/lib/utils"

interface MentionBadgeProps {
  count: number
  maxCount?: number
  className?: string
}

export function MentionBadge({ count, maxCount = 99, className }: MentionBadgeProps) {
  if (count <= 0) return null

  const displayCount = count > maxCount ? `${maxCount}+` : count.toString()

  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-medium text-destructive-foreground",
        className
      )}
    >
      @{displayCount}
    </span>
  )
}
