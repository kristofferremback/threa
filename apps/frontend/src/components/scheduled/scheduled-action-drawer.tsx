import { Pencil, Send, Trash2 } from "lucide-react"
import type { ScheduledMessageView } from "@threa/types"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { stripMarkdownToInline } from "@/lib/markdown"

interface ScheduledActionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scheduled: ScheduledMessageView
  onEdit?: (id: string) => void
  onSendNow?: (id: string) => void
  onCancel?: (id: string) => void
}

/**
 * Mobile action sheet opened via long-press on a scheduled-message row.
 * Mirrors the convention used by `MessageActionDrawer` on the timeline:
 * tiny tap targets are replaced with a bottom sheet whose buttons are large,
 * thumb-reachable, and labelled. Header echoes the message preview so the
 * user knows which row they're acting on.
 */
export function ScheduledActionDrawer({
  open,
  onOpenChange,
  scheduled,
  onEdit,
  onSendNow,
  onCancel,
}: ScheduledActionDrawerProps) {
  const previewText = stripMarkdownToInline(scheduled.contentMarkdown).trim() || "(empty)"
  const close = () => onOpenChange(false)
  const isPending = scheduled.status === "pending"

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[60dvh]">
        <DrawerTitle className="sr-only">Scheduled message actions</DrawerTitle>
        <div className="flex flex-col px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-1">
          <p className="line-clamp-2 text-sm text-muted-foreground">{previewText}</p>
          <div className="mt-3 flex flex-col gap-1">
            {onEdit && isPending && (
              <Button
                variant="ghost"
                className="h-12 justify-start gap-3 text-base"
                onClick={() => {
                  onEdit(scheduled.id)
                  close()
                }}
              >
                <Pencil className="h-5 w-5" />
                Edit
              </Button>
            )}
            {onSendNow && isPending && (
              <Button
                variant="ghost"
                className="h-12 justify-start gap-3 text-base"
                onClick={() => {
                  onSendNow(scheduled.id)
                  close()
                }}
              >
                <Send className="h-5 w-5" />
                Send now
              </Button>
            )}
            {onCancel && (
              <Button
                variant="ghost"
                className="h-12 justify-start gap-3 text-base text-destructive hover:text-destructive"
                onClick={() => {
                  onCancel(scheduled.id)
                  close()
                }}
              >
                <Trash2 className="h-5 w-5" />
                {scheduled.status === "failed" ? "Remove" : "Cancel"}
              </Button>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
