import { useState, useMemo, useEffect } from "react"
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

  // Reset selection if the selected emoji's reactions were removed in real-time
  useEffect(() => {
    if (selectedEmoji && !sortedEntries.some(([sc]) => sc === selectedEmoji)) {
      setSelectedEmoji(null)
    }
  }, [selectedEmoji, sortedEntries])

  const totalCount = useMemo(() => sortedEntries.reduce((sum, [, users]) => sum + users.length, 0), [sortedEntries])

  const displayedUsers = useMemo(() => {
    if (!selectedEmoji) {
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
        {/* Emoji filter tabs */}
        <div className="flex gap-0.5 px-1.5 pt-1.5 pb-1 overflow-x-auto scrollbar-none">
          <button
            type="button"
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              !selectedEmoji ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/80"
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
                  "shrink-0 rounded-md px-1.5 py-1 text-xs transition-colors inline-flex items-center gap-0.5",
                  selectedEmoji === shortcode ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/80"
                )}
                onClick={() => setSelectedEmoji(shortcode)}
              >
                <span>{emoji ?? shortcode}</span>
                <span className="tabular-nums">{users.length}</span>
              </button>
            )
          })}
        </div>

        <div className="border-t border-border/50" />

        {/* User list */}
        <div className="max-h-[180px] overflow-y-auto py-1 px-1">
          {displayedUsers.map(({ userId, emojis }) => (
            <div
              key={userId}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors"
            >
              <span className="truncate flex-1 text-foreground/90">{getActorName(userId, "user")}</span>
              <span className="shrink-0 text-base flex gap-0.5">
                {emojis.map((shortcode) => (
                  <span key={shortcode}>{toEmoji(shortcode) ?? shortcode}</span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
