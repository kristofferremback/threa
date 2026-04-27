import { useState } from "react"
import { Link } from "react-router-dom"
import { CornerDownRight, X } from "lucide-react"
import type { StreamEvent, MessagesMovedEventPayload, MovedMessagePreview } from "@threa/types"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogClose,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog"
import { ActorAvatar } from "@/components/actor-avatar"
import { RelativeTime } from "@/components/relative-time"
import { useActors, type ActorLookup } from "@/hooks"
import { stripMarkdownToInline } from "@/lib/markdown/strip"

interface MessagesMovedEventProps {
  event: StreamEvent
  workspaceId: string
  streamId: string
}

function formatStreamName(displayName: string | null, slug: string | null): string | null {
  if (displayName) return displayName
  if (slug) return `#${slug}`
  return null
}

/**
 * Minimal in-timeline trace of a move operation. Renders as a single line
 * — "Actor moved N messages" — that opens a drawer with full per-message
 * detail. The icon is the same `CornerDownRight` used by the move action
 * everywhere so the visual identity is consistent.
 */
export function MessagesMovedEvent({ event, workspaceId, streamId }: MessagesMovedEventProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const payload = event.payload as MessagesMovedEventPayload
  const { getActorName } = useActors(workspaceId)
  const moverName = getActorName(event.actorId, event.actorType)

  const count = payload.messages.length
  const noun = count === 1 ? "message" : "messages"

  return (
    <>
      <div className="py-2 px-3 sm:px-6 text-center">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1.5 hover:underline underline-offset-2"
          aria-label={`Show ${count} moved ${noun}`}
        >
          <CornerDownRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium">{moverName}</span> moved {count} {noun}
          </span>
        </button>
      </div>
      <MovedMessagesDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        event={event}
        payload={payload}
        workspaceId={workspaceId}
        currentStreamId={streamId}
        moverName={moverName}
      />
    </>
  )
}

interface MovedMessagesDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  event: StreamEvent
  payload: MessagesMovedEventPayload
  workspaceId: string
  currentStreamId: string
  moverName: string
}

function MovedMessagesDrawer({
  open,
  onOpenChange,
  event,
  payload,
  workspaceId,
  currentStreamId,
  moverName,
}: MovedMessagesDrawerProps) {
  // One `useActors` call for the whole drawer — without this hoist each
  // `MovedMessageRow` would subscribe its own copy of the workspace
  // users/personas/bots live queries, so a 50-message move would create
  // 150 redundant IDB subscriptions for identical data. Mirrors the
  // membership-event.tsx pattern (single call at the parent).
  const actors = useActors(workspaceId)
  const sourceLabel = formatStreamName(payload.sourceStreamDisplayName, payload.sourceStreamSlug) ?? "another stream"
  const destinationLabel =
    formatStreamName(payload.destinationStreamDisplayName, payload.destinationStreamSlug) ?? "a thread"
  const isOutbound = currentStreamId === payload.sourceStreamId
  const count = payload.messages.length
  const noun = count === 1 ? "message" : "messages"

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="max-w-2xl max-h-[85vh] sm:flex flex-col p-0 gap-0 [&>button:last-child]:hidden"
        drawerClassName="flex flex-col p-0"
        hideCloseButton
      >
        <div className="px-4 sm:px-6 py-4 border-b shrink-0 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <ResponsiveDialogTitle className="text-base font-semibold flex items-center gap-2">
              <CornerDownRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {moverName} moved {count} {noun}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="mt-1 text-xs text-muted-foreground inline-flex items-center gap-1.5 flex-wrap">
              <RelativeTime date={event.createdAt} className="text-xs text-muted-foreground" />
              <span aria-hidden="true">•</span>
              <Link
                to={`/w/${workspaceId}/s/${payload.sourceStreamId}`}
                className="font-medium text-foreground hover:underline underline-offset-2"
              >
                {sourceLabel}
              </Link>
              <span aria-hidden="true">→</span>
              <Link
                to={`/w/${workspaceId}/s/${payload.destinationStreamId}`}
                className="font-medium text-foreground hover:underline underline-offset-2"
              >
                {destinationLabel}
              </Link>
              {isOutbound && <span className="text-muted-foreground">(outbound)</span>}
              {!isOutbound && <span className="text-muted-foreground">(inbound)</span>}
            </ResponsiveDialogDescription>
          </div>
          <ResponsiveDialogClose className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0">
            <X className="w-5 h-5" />
            <span className="sr-only">Close</span>
          </ResponsiveDialogClose>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 sm:px-3 py-2">
          <ul className="flex flex-col gap-1">
            {payload.messages.map((message) => (
              <MovedMessageRow
                key={message.id}
                message={message}
                workspaceId={workspaceId}
                destinationStreamId={payload.destinationStreamId}
                actors={actors}
                onNavigate={() => onOpenChange(false)}
              />
            ))}
          </ul>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

interface MovedMessageRowProps {
  message: MovedMessagePreview
  workspaceId: string
  destinationStreamId: string
  actors: ActorLookup
  onNavigate: () => void
}

function MovedMessageRow({ message, workspaceId, destinationStreamId, actors, onNavigate }: MovedMessageRowProps) {
  const authorName = actors.getActorName(message.authorId, message.authorType)
  // Preview field is markdown by design — INV-60 carve-out for preview
  // surfaces. Strip + truncate at render so display stays plain text.
  const stripped = stripMarkdownToInline(message.contentMarkdown).trim()
  const previewText = stripped.length > 0 ? stripped : "(empty message)"

  return (
    <li>
      <Link
        to={`/w/${workspaceId}/s/${destinationStreamId}?m=${message.id}`}
        onClick={onNavigate}
        className="block px-3 py-2 rounded-md hover:bg-muted/60 transition-colors group"
      >
        <div className="flex items-start gap-3 min-w-0">
          <ActorAvatar
            actorId={message.authorId}
            actorType={message.authorType}
            workspaceId={workspaceId}
            size="sm"
            alt={authorName}
            className="shrink-0 mt-0.5"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-medium text-sm truncate">{authorName}</span>
              <RelativeTime date={message.createdAt} className="text-xs text-muted-foreground shrink-0" />
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2 group-hover:text-foreground transition-colors">
              {previewText}
            </p>
          </div>
        </div>
      </Link>
    </li>
  )
}
