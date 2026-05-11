import type { ComponentType, ReactNode } from "react"
import { Link } from "react-router-dom"
import { X } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Lifecycle status shared between file-upload pills and context-ref pills.
 *
 * - `default` — fully resolved (uploaded file, ready/inline context-ref).
 * - `pending` — in-flight (upload progressing, precompute in flight).
 * - `error`   — terminal failure.
 *
 * Drives the visual state on a single primitive so files + context-refs
 * read as one type of "thing attached to the message" — sets up the data
 * model for an eventual unified bag where attachments live as another
 * ref kind.
 */
export type AttachmentPillStatus = "default" | "pending" | "error"

export interface AttachmentPillProps {
  /** Lucide icon component rendered at the leading edge of the pill. */
  icon: ComponentType<{ className?: string }>
  /** Primary label (filename, ref label, etc.). Truncated to fit. */
  label: string
  /** Optional secondary text rendered after the label (size, count, etc.). */
  secondary?: ReactNode
  /** Visual status — gates the border/bg palette and animations. */
  status?: AttachmentPillStatus
  /** Hover tooltip body. */
  tooltip?: ReactNode
  /** Remove handler. When provided renders a small × button at the trailing edge. */
  onRemove?: () => void
  /** Internal route to navigate to on click — turns the pill into a `<Link>`. */
  href?: string
  /** Aria label for the remove button. */
  removeLabel?: string
  /** Override the truncation max-width on the label. */
  labelMaxWidth?: string
  className?: string
}

const STATUS_STYLES: Record<AttachmentPillStatus, string> = {
  default: "border border-primary/30 bg-card text-primary",
  pending: "border border-dashed border-muted-foreground/40 bg-card text-muted-foreground",
  error: "border border-destructive bg-card text-destructive",
}

const STATUS_REMOVE_HOVER: Record<AttachmentPillStatus, string> = {
  default: "hover:bg-primary/20",
  pending: "hover:bg-muted",
  error: "hover:bg-destructive/20",
}

const SECONDARY_TONE: Record<AttachmentPillStatus, string> = {
  default: "text-primary/70",
  pending: "text-muted-foreground",
  error: "text-destructive/80",
}

/**
 * Canonical pill primitive used by the composer attachment row and the
 * timeline message context-ref badge. Keeps file uploads, context refs,
 * and any future bag entry visually consistent — same shape, same
 * spacing, same status palette, same remove + link affordances.
 */
export function AttachmentPill({
  icon: Icon,
  label,
  secondary,
  status = "default",
  tooltip,
  onRemove,
  href,
  removeLabel,
  labelMaxWidth = "max-w-[160px]",
  className,
}: AttachmentPillProps) {
  // Matches `<Button variant="outline" size="sm" className="h-8 gap-2 text-xs">` —
  // the canonical attachment surface used by `<AttachmentList>` for sent-message
  // file cards. Keeping pre-send composer pills and post-send message pills at
  // identical metrics so the chip's size doesn't change as it "moves" from
  // composer to timeline.
  const baseStyles = "inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs select-none"
  const statusStyles = STATUS_STYLES[status]

  const inner = (
    <>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", status === "pending" && "animate-spin")} />
      <span className={cn("truncate", labelMaxWidth)}>{label}</span>
      {secondary != null && <span className={SECONDARY_TONE[status]}>{secondary}</span>}
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRemove()
          }}
          className={cn(
            "ml-0.5 rounded-full p-0.5 opacity-60 hover:opacity-100 transition-opacity",
            STATUS_REMOVE_HOVER[status]
          )}
          aria-label={removeLabel ?? "Remove"}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </>
  )

  const pill = href ? (
    <Link
      to={href}
      className={cn(baseStyles, statusStyles, "cursor-pointer hover:brightness-110 transition-[filter]", className)}
    >
      {inner}
    </Link>
  ) : (
    <div className={cn(baseStyles, statusStyles, className)}>{inner}</div>
  )

  if (!tooltip) return pill

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{pill}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          {typeof tooltip === "string" ? <p className="text-sm">{tooltip}</p> : tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
