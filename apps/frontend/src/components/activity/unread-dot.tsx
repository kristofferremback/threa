import { cn } from "@/lib/utils"

export function UnreadDot({ isUnread }: { isUnread: boolean }) {
  return (
    <div className="mt-2 flex-shrink-0">
      <div className={cn("h-2 w-2 rounded-full transition-colors", isUnread ? "bg-blue-500" : "bg-transparent")} />
    </div>
  )
}
