import { useCallback, useState } from "react"
import type { ReactNode } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, CalendarClock, Pause, Play, Send, Trash2, Pencil, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { ScheduledMessageStatuses, type ScheduledMessageView } from "@threa/types"
import { Button } from "@/components/ui/button"
import { SidebarToggle } from "@/components/layout"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  useDeleteScheduledMessage,
  usePauseScheduledMessage,
  useResumeScheduledMessage,
  useScheduledMessagesList,
  useSendScheduledMessageNow,
} from "@/hooks"
import { formatRelativeTime } from "@/lib/dates"
import { stripMarkdownToInline } from "@/lib/markdown"
import { cn } from "@/lib/utils"

export function ScheduledPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [inFlightId, setInFlightId] = useState<string | null>(null)
  const { items, isLoading } = useScheduledMessagesList(workspaceId ?? "")
  const pauseMutation = usePauseScheduledMessage(workspaceId ?? "")
  const resumeMutation = useResumeScheduledMessage(workspaceId ?? "")
  const sendNowMutation = useSendScheduledMessageNow(workspaceId ?? "")
  const deleteMutation = useDeleteScheduledMessage(workspaceId ?? "")

  const runAction = useCallback(
    async (item: ScheduledMessageView, action: () => Promise<unknown>, success: string) => {
      if (inFlightId) return
      setInFlightId(item.id)
      try {
        await action()
        toast.success(success)
      } catch {
        toast.error("Could not update scheduled message")
      } finally {
        setInFlightId(null)
      }
    },
    [inFlightId]
  )

  if (!workspaceId) return null

  let content: ReactNode
  if (isLoading && items.length === 0) {
    content = <div className="p-4 text-sm text-muted-foreground">Loading scheduled messages...</div>
  } else if (items.length === 0) {
    content = (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No scheduled messages
      </div>
    )
  } else {
    content = (
      <div className="mx-auto flex w-full max-w-3xl flex-col divide-y">
        {items.map((item) => {
          const disabled = inFlightId === item.id
          return (
            <article key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  if (item.status === ScheduledMessageStatuses.SENT && item.sentMessageId) {
                    navigate(`/w/${workspaceId}/s/${item.streamId}?m=${item.sentMessageId}`)
                    return
                  }
                  navigate(`/w/${workspaceId}/s/${item.streamId}?scheduled=${item.id}`)
                }}
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusIcon status={item.status} />
                  <span className="capitalize">{item.status}</span>
                  <span>·</span>
                  <span>{item.streamName ?? "Conversation"}</span>
                </div>
                <p className="mt-1 line-clamp-2 break-words text-sm">{preview(item)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{timestampLabel(item)}</p>
              </button>

              {item.status !== ScheduledMessageStatuses.SENT && (
                <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
                  <IconAction
                    label="Edit scheduled message"
                    icon={Pencil}
                    disabled={disabled}
                    onClick={() => navigate(`/w/${workspaceId}/s/${item.streamId}?scheduled=${item.id}`)}
                  />
                  {item.status === ScheduledMessageStatuses.PAUSED ? (
                    <IconAction
                      label="Resume"
                      icon={Play}
                      disabled={disabled}
                      onClick={() =>
                        runAction(
                          item,
                          () => resumeMutation.mutateAsync({ scheduledId: item.id, expectedVersion: item.version }),
                          "Scheduled message resumed"
                        )
                      }
                    />
                  ) : (
                    <IconAction
                      label="Pause"
                      icon={Pause}
                      disabled={disabled}
                      onClick={() =>
                        runAction(
                          item,
                          () => pauseMutation.mutateAsync({ scheduledId: item.id, expectedVersion: item.version }),
                          "Scheduled message paused"
                        )
                      }
                    />
                  )}
                  <IconAction
                    label="Send now"
                    icon={Send}
                    disabled={disabled}
                    onClick={() =>
                      runAction(
                        item,
                        () => sendNowMutation.mutateAsync({ scheduledId: item.id, expectedVersion: item.version }),
                        "Scheduled to send now"
                      )
                    }
                  />
                  <IconAction
                    label="Delete"
                    icon={Trash2}
                    destructive
                    disabled={disabled}
                    onClick={() =>
                      runAction(
                        item,
                        () => deleteMutation.mutateAsync({ scheduledId: item.id, expectedVersion: item.version }),
                        "Scheduled message deleted"
                      )
                    }
                  />
                </div>
              )}
            </article>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center gap-2 border-b px-4">
        <SidebarToggle location="page" />
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link to={`/w/${workspaceId}`} aria-label="Back to workspace">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-semibold">Scheduled</h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">{content}</main>
    </div>
  )
}

function formatScheduledAt(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function preview(item: ScheduledMessageView): string {
  const text = stripMarkdownToInline(item.contentMarkdown).trim()
  if (text) return text
  if (item.attachmentIds.length > 0)
    return `${item.attachmentIds.length} attachment${item.attachmentIds.length === 1 ? "" : "s"}`
  return "Empty message"
}

function timestampLabel(item: ScheduledMessageView): string {
  if (item.status === ScheduledMessageStatuses.SENT && item.sentAt) {
    return `Sent ${formatRelativeTime(new Date(item.sentAt), new Date(), undefined, { terse: true })}`
  }
  return `Sends ${formatScheduledAt(item.scheduledAt)}`
}

function StatusIcon({ status }: { status: ScheduledMessageView["status"] }) {
  if (status === ScheduledMessageStatuses.SENT) return <CheckCircle2 className="h-3.5 w-3.5" />
  if (status === ScheduledMessageStatuses.PAUSED || status === ScheduledMessageStatuses.EDITING) {
    return <Pause className="h-3.5 w-3.5" />
  }
  return <CalendarClock className="h-3.5 w-3.5" />
}

function IconAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  destructive = false,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn("h-8 w-8", destructive && "text-destructive hover:text-destructive hover:bg-destructive/10")}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
