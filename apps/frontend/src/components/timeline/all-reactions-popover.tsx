import { useState, useMemo } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useActors } from "@/hooks"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { cn } from "@/lib/utils"

interface AllReactionsPopoverProps {
  reactions: Record<string, string[]>
  workspaceId: string
  children: React.ReactNode
}

export function AllReactionsPopover({ reactions, workspaceId, children }: AllReactionsPopoverProps) {
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null)
  const { getActorName } = useActors(workspaceId)
  const { toEmoji } = useWorkspaceEmoji(workspaceId)

  const sortedEntries = useMemo(() => {
    return Object.entries(reactions)
      .filter(([, users]) => users.length > 0)
      .sort((a, b) => b[1].length - a[1].length)
  }, [reactions])

  const totalCount = useMemo(() => sortedEntries.reduce((sum, [, users]) => sum + users.length, 0), [sortedEntries])

  const displayedUsers = useMemo(() => {
    if (!selectedEmoji) {
      // "All" tab — show all unique users with their emoji
      const seen = new Map<string, string[]>()
      for (const [emoji, userIds] of sortedEntries) {
        for (const userId of userIds) {
          const existing = seen.get(userId)
          if (existing) {
            existing.push(emoji)
          } else {
            seen.set(userId, [emoji])
          }
        }
      }
      return Array.from(seen.entries()).map(([userId, emojis]) => ({ userId, emojis }))
    }
    const userIds = reactions[selectedEmoji] ?? []
    return userIds.map((userId) => ({ userId, emojis: [selectedEmoji] }))
  }, [selectedEmoji, sortedEntries, reactions])

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[260px] p-0">
        {/* Emoji tabs */}
        <div className="flex gap-1 px-2 pt-2 pb-1 overflow-x-auto">
          <button
            type="button"
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              !selectedEmoji ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted"
            )}
            onClick={() => setSelectedEmoji(null)}
          >
            All {totalCount}
          </button>
          {sortedEntries.map(([shortcode, users]) => {
            const emoji = toEmoji(shortcode)
            return (
              <button
                key={shortcode}
                type="button"
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-xs transition-colors",
                  selectedEmoji === shortcode
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
                onClick={() => setSelectedEmoji(shortcode)}
              >
                <span className="mr-0.5">{emoji ?? shortcode}</span>
                {users.length}
              </button>
            )
          })}
        </div>

        {/* User list */}
        <div className="max-h-[200px] overflow-y-auto px-2 pb-2">
          {displayedUsers.map(({ userId, emojis }) => (
            <div key={userId} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
              <span className="truncate flex-1">{getActorName(userId, "user")}</span>
              <span className="shrink-0 text-base">
                {emojis.map((shortcode) => (
                  <span key={shortcode} className="ml-0.5">
                    {toEmoji(shortcode) ?? shortcode}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
