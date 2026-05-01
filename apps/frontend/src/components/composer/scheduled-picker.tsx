import { useCallback, useMemo, useState } from "react"
import { Clock, Trash2 } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { stripMarkdownToInline } from "@/lib/markdown"
import { formatRelativeTime } from "@/lib/dates"
import { cn } from "@/lib/utils"

interface ScheduledPickerItem {
  id: string
  contentMarkdown: string | unknown
  attachmentIds?: string[]
  scheduledAt: string
  streamDisplayName: string | null
}

interface ScheduledPickerProps {
  scheduled: ScheduledPickerItem[]
  /** Workspace id for linking to the full scheduled page. */
  workspaceId: string
  /** Called when the user clicks the cancel icon on a row. */
  onCancel: (id: string) => void
  /** When `controlsDisabled`, the trigger button is disabled (e.g. composer is sending). */
  controlsDisabled?: boolean
  /**
   * Visual size of the trigger button. `compact` matches the 7x7 toolbar row on
   * desktop inline; `fab` matches the 30x30 floating drawer in expanded mode.
   */
  size?: "compact" | "fab"
}

function getPreview(scheduled: ScheduledPickerItem): string {
  const contentMarkdown = typeof scheduled.contentMarkdown === "string" ? scheduled.contentMarkdown : ""
  const stripped = stripMarkdownToInline(contentMarkdown).trim()
  if (stripped.length > 0) return stripped
  const attachmentCount = scheduled.attachmentIds?.length ?? 0
  if (attachmentCount > 0) {
    return `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`
  }
  return "Empty message"
}

export function ScheduledPicker({
  scheduled,
  workspaceId,
  onCancel,
  controlsDisabled = false,
  size = "compact",
}: ScheduledPickerProps) {
  const [open, setOpen] = useState(false)
  const count = scheduled.length
  const now = useMemo(() => new Date(), [open])

  const handleCancel = useCallback(
    (id: string) => {
      onCancel(id)
    },
    [onCancel]
  )

  const triggerSizeClass = size === "fab" ? "h-[30px] w-[30px] rounded-md bg-background shadow-md" : "h-7 w-7"
  const triggerIconClass = size === "fab" ? "h-4 w-4" : "h-3.5 w-3.5"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={size === "fab" ? "outline" : "ghost"}
              size="icon"
              aria-label={count > 0 ? `Scheduled (${count})` : "Scheduled"}
              className={cn("relative shrink-0 p-0", triggerSizeClass)}
              disabled={controlsDisabled}
              onPointerDown={size === "fab" ? (e) => e.preventDefault() : undefined}
            >
              <Clock className={triggerIconClass} />
              {count > 0 && (
                <span
                  className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-muted-foreground/60 pointer-events-none"
                  aria-hidden
                />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Scheduled
        </TooltipContent>
      </Tooltip>

      <PopoverContent align="end" side="top" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
          <p className="text-sm font-medium">
            Scheduled
            {count > 0 && <span className="text-muted-foreground font-normal ml-1.5">({count})</span>}
          </p>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs" asChild>
            <Link to={`/w/${workspaceId}/scheduled`} onClick={() => setOpen(false)}>
              View all
            </Link>
          </Button>
        </div>

        {scheduled.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No scheduled messages. Long-press the send button to schedule one.
          </div>
        ) : (
          <ul className="max-h-64 overflow-y-auto py-1" role="list">
            {scheduled.map((item) => {
              const preview = getPreview(item)
              return (
                <li key={item.id} className="group/row">
                  <div className="flex items-start gap-2 px-3 py-2 hover:bg-muted/60">
                    <div className="flex-1 min-w-0">
                      {item.streamDisplayName && (
                        <p className="text-[11px] text-muted-foreground truncate mb-0.5">{item.streamDisplayName}</p>
                      )}
                      <p className="text-sm line-clamp-2 break-words">{preview}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {formatRelativeTime(new Date(item.scheduledAt), now, undefined, { terse: true })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Cancel scheduled message"
                      className="h-7 w-7 shrink-0 opacity-0 group-hover/row:opacity-100 focus:opacity-100 max-sm:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCancel(item.id)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
