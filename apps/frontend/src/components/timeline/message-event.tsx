import { type ReactNode, useRef, useEffect, useState, useMemo, useCallback } from "react"
import {
  isSentViaApi,
  type StreamEvent,
  type AttachmentSummary,
  type JSONContent,
  type LinkPreviewSummary,
} from "@threa/types"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { enqueueOperation } from "@/sync/operation-queue"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { MarkdownContent, AttachmentProvider } from "@/components/ui/markdown-content"
import { RelativeTime } from "@/components/relative-time"
import { PersonaAvatar } from "@/components/persona-avatar"
import { usePendingMessages, usePanel, createDraftPanelId, useTrace, useMessageService } from "@/contexts"
import { useUserProfile } from "@/components/user-profile"
import { useEditLastMessage } from "./edit-last-message-context"
import { useInlineEdit } from "./inline-edit-context"
import {
  useActors,
  useWorkspaceUserId,
  useMessageReactions,
  stripColons,
  getStepLabel,
  focusAtEnd,
  type MessageAgentActivity,
} from "@/hooks"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { useLongPress } from "@/hooks/use-long-press"
import { AttachmentList } from "./attachment-list"
import { LinkPreviewList } from "./link-preview-list"
import { LinkPreviewProvider, useLinkPreviewContext } from "@/lib/markdown/link-preview-context"
import { MessageContextMenu } from "./message-context-menu"
import { MessageActionDrawer } from "./message-action-drawer"
import { ThreadIndicator } from "./thread-indicator"
import { DeleteMessageDialog } from "./delete-message-dialog"
import { MessageEditForm } from "./message-edit-form"
import { EditedIndicator } from "./edited-indicator"
import { MessageHistoryDialog } from "./message-history-dialog"
import { MessageReactions } from "./message-reactions"
import { ReactionEmojiPicker } from "./reaction-emoji-picker"

interface MessagePayload {
  messageId: string
  contentMarkdown: string
  contentJson?: JSONContent
  attachments?: AttachmentSummary[]
  linkPreviews?: LinkPreviewSummary[]
  replyCount?: number
  threadId?: string
  sessionId?: string
  editedAt?: string
  sentVia?: string
  reactions?: Record<string, string[]>
}

interface MessageEventProps {
  event: StreamEvent
  workspaceId: string
  streamId: string
  /** This message is the thread parent shown at the top of the thread panel */
  isThreadParent?: boolean
  /** Whether to highlight this message (scroll into view and flash) */
  isHighlighted?: boolean
  /** Whether this message just arrived via socket (brief subtle indicator) */
  isNew?: boolean
  /** Active agent session triggered by this message */
  activity?: MessageAgentActivity
  /** Defer non-critical per-message hydration until coordinated reveal completes */
  deferSecondaryHydration?: boolean
}

interface MessageLayoutProps {
  event: StreamEvent
  payload: MessagePayload
  workspaceId: string
  actorName: string
  actorInitials: string
  /** Persona slug for SVG icon support (e.g., "ariadne") */
  personaSlug?: string
  /** User avatar image URL */
  actorAvatarUrl?: string
  statusIndicator: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  containerClassName?: string
  isHighlighted?: boolean
  isNew?: boolean
  isEditing?: boolean
  containerRef?: React.RefObject<HTMLDivElement | null>
  deferSecondaryHydration?: boolean
  /** Touch event handlers for mobile long-press */
  touchHandlers?: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchEnd: () => void
    onTouchMove: (e: React.TouchEvent) => void
    onContextMenu: (e: React.MouseEvent) => void
  }
}

function focusVisibleZoneEditor(zone: HTMLElement | null, attempt = 0) {
  if (!zone) return

  const editor = Array.from(zone.querySelectorAll<HTMLElement>('[contenteditable="true"]'))
    .filter((element) => !element.closest("[data-inline-edit]"))
    .reduceRight<HTMLElement | null>((match, element) => {
      if (match) return match
      return element.getClientRects().length > 0 ? element : null
    }, null)

  if (editor) {
    focusAtEnd(editor)
    return
  }

  if (attempt >= 4) return
  requestAnimationFrame(() => focusVisibleZoneEditor(zone, attempt + 1))
}

/** Reads hovered link URL from context and passes to LinkPreviewList */
function MessageLinkPreviews({
  messageId,
  workspaceId,
  previews,
  hydrateFromApi,
}: {
  messageId: string
  workspaceId: string
  previews?: LinkPreviewSummary[]
  hydrateFromApi?: boolean
}) {
  const linkPreviewContext = useLinkPreviewContext()
  return (
    <LinkPreviewList
      messageId={messageId}
      workspaceId={workspaceId}
      previews={previews}
      hoveredUrl={linkPreviewContext?.hoveredLinkUrl}
      hydrateFromApi={hydrateFromApi}
    />
  )
}

function MessageLayout({
  event,
  payload,
  workspaceId,
  actorName,
  actorInitials,
  personaSlug,
  actorAvatarUrl,
  statusIndicator,
  actions,
  footer,
  children,
  containerClassName,
  isHighlighted,
  isNew,
  isEditing,
  containerRef,
  deferSecondaryHydration,
  touchHandlers,
}: MessageLayoutProps) {
  const isPersona = event.actorType === "persona"
  const isSystem = event.actorType === "system"
  const isBot = event.actorType === "bot"
  const isUser = event.actorType === "user"
  const { openUserProfile } = useUserProfile()

  return (
    <div
      ref={containerRef}
      {...touchHandlers}
      className={cn(
        "message-item group relative flex gap-[14px] mb-5 px-3 sm:px-6",
        // AI/Persona messages get full-width gradient with gold accent
        isPersona &&
          "bg-gradient-to-r from-primary/[0.06] to-transparent py-4 shadow-[inset_3px_0_0_hsl(var(--primary))]",
        // Bot messages get emerald accent
        isBot && "bg-gradient-to-r from-emerald-500/[0.06] to-transparent py-4 shadow-[inset_3px_0_0_hsl(152_69%_41%)]",
        // System messages get a subtle info-toned accent
        isSystem &&
          "bg-gradient-to-r from-blue-500/[0.04] to-transparent py-4 shadow-[inset_3px_0_0_hsl(210_100%_55%)]",
        // Edit mode: pseudo-element background so no layout shift — zero padding/margin changes
        isEditing &&
          !isPersona &&
          !isBot &&
          !isSystem &&
          "before:content-[''] before:absolute before:-top-4 before:-bottom-4 before:left-0 before:right-0 before:bg-primary/[0.04] before:-z-10",
        isHighlighted && "animate-highlight-flash",
        isNew && !isHighlighted && "animate-new-message-fade",
        containerClassName
      )}
    >
      {isPersona ? (
        <PersonaAvatar slug={personaSlug} fallback={actorInitials} size="md" className="message-avatar" />
      ) : (
        <Avatar className="message-avatar h-9 w-9 rounded-[10px] shrink-0">
          {actorAvatarUrl && <AvatarImage src={actorAvatarUrl} alt={actorName} />}
          <AvatarFallback
            className={cn(
              "text-foreground",
              isSystem && "bg-blue-500/10 text-blue-500",
              isBot && "bg-emerald-500/10 text-emerald-600",
              !isSystem && !isBot && "bg-muted"
            )}
          >
            {actorInitials}
          </AvatarFallback>
        </Avatar>
      )}
      <div className="message-content flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          {isUser && event.actorId ? (
            <button
              type="button"
              onClick={() => openUserProfile(event.actorId!)}
              className={cn("font-semibold text-sm hover:underline text-left")}
            >
              {actorName}
            </button>
          ) : (
            <span
              className={cn(
                "font-semibold text-sm",
                isPersona && "text-primary",
                isBot && "text-emerald-600",
                isSystem && "text-blue-500"
              )}
            >
              {actorName}
            </span>
          )}
          {isBot && <span className="text-[10px] text-emerald-600/70 font-medium cursor-default">BOT</span>}
          {payload.sentVia && isSentViaApi(payload.sentVia) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[10px] text-muted-foreground/70 font-medium cursor-default">via API</span>
              </TooltipTrigger>
              <TooltipContent>Sent on behalf of this user by an API key</TooltipContent>
            </Tooltip>
          )}
          {statusIndicator}
          {actions}
        </div>
        {children ?? (
          <LinkPreviewProvider>
            <AttachmentProvider workspaceId={workspaceId} attachments={payload.attachments ?? []}>
              <MarkdownContent content={payload.contentMarkdown} className="text-sm leading-relaxed" />
              {payload.attachments && payload.attachments.length > 0 && (
                <AttachmentList
                  attachments={payload.attachments}
                  workspaceId={workspaceId}
                  deferHydration={deferSecondaryHydration}
                />
              )}
              <MessageLinkPreviews
                messageId={payload.messageId}
                workspaceId={workspaceId}
                previews={payload.linkPreviews}
                hydrateFromApi={!deferSecondaryHydration}
              />
            </AttachmentProvider>
          </LinkPreviewProvider>
        )}
        {footer}
      </div>
    </div>
  )
}

interface MessageEventInnerProps {
  event: StreamEvent
  payload: MessagePayload
  workspaceId: string
  streamId: string
  actorName: string
  actorInitials: string
  personaSlug?: string
  actorAvatarUrl?: string
  isThreadParent?: boolean
  isHighlighted?: boolean
  isNew?: boolean
  activity?: MessageAgentActivity
  deferSecondaryHydration?: boolean
}

function SentMessageEvent({
  event,
  payload,
  workspaceId,
  streamId,
  actorName,
  actorInitials,
  personaSlug,
  actorAvatarUrl,
  isThreadParent: isThreadParentProp,
  isHighlighted,
  isNew,
  activity,
  deferSecondaryHydration,
}: MessageEventInnerProps) {
  const { panelId, getPanelUrl } = usePanel()
  const messageService = useMessageService()
  const currentUserId = useWorkspaceUserId(workspaceId)
  const { getTraceUrl } = useTrace()
  const replyCount = payload.replyCount ?? 0
  const threadId = payload.threadId
  const containerRef = useRef<HTMLDivElement>(null)

  const [isEditing, setIsEditing] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [mobilePickerOpen, setMobilePickerOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Mobile: long-press opens action drawer instead of dropdown
  const isMobile = useIsMobile()
  const inlineEdit = useInlineEdit()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const longPress = useLongPress({
    onLongPress: openDrawer,
    enabled: isMobile && !isEditing,
  })

  const startEditing = useCallback(() => {
    setIsEditing(true)
    if (isMobile) {
      inlineEdit?.setEditingInline(true)
    }
  }, [isMobile, inlineEdit])

  // Reset inline edit context if the message unmounts while being edited
  // (e.g., message deleted by another user mid-edit)
  useEffect(() => {
    return () => {
      if (isEditing && isMobile) {
        inlineEdit?.setEditingInline(false)
      }
    }
  }, [isEditing, isMobile, inlineEdit])

  // Restore focus to the zone's editor after exiting inline edit mode
  const stopEditing = useCallback(() => {
    const zone = containerRef.current?.closest<HTMLElement>("[data-editor-zone]") ?? null
    setIsEditing(false)
    if (isMobile) {
      inlineEdit?.setEditingInline(false)
      return
    }
    requestAnimationFrame(() => focusVisibleZoneEditor(zone))
  }, [isMobile, inlineEdit])

  // Register this message's edit handler with the context so the composer's ArrowUp trigger
  // can imperatively open edit mode and scroll into view. Unregistered on unmount.
  const { registerMessage } = useEditLastMessage() ?? {}
  useEffect(() => {
    if (!registerMessage) return
    return registerMessage(payload.messageId, () => {
      containerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      startEditing()
    })
  }, [payload.messageId, registerMessage, startEditing])

  // Scroll to this message when highlighted
  useEffect(() => {
    if (isHighlighted && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [isHighlighted])

  // Create draft panel URL for messages that don't have a thread yet
  const draftPanelId = createDraftPanelId(streamId, payload.messageId)
  const draftPanelUrl = getPanelUrl(draftPanelId)

  // Activity label for inline display in the footer
  const activityLabel = activity
    ? `${activity.personaName} is ${getStepLabel(activity.currentStepType).toLowerCase()}`
    : null

  // Thread link or "Reply in thread" text (hidden when hideActions is true)
  // Shows on hover when no thread exists yet, or always when thread exists
  // When agent activity is present, the activity text is always visible on the same line
  // When activity.threadStreamId is present, use it for the thread link (allows immediate
  // navigation to the real thread before the slower stream:created event updates threadId)
  const effectiveThreadId = threadId ?? activity?.threadStreamId
  let replyLink = (
    <Link
      to={draftPanelUrl}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:underline transition-opacity",
        !activityLabel && "opacity-0 group-hover:opacity-100 max-sm:opacity-100"
      )}
    >
      Reply in thread
    </Link>
  )

  if (effectiveThreadId) {
    replyLink =
      replyCount > 0 ? (
        <ThreadIndicator replyCount={replyCount} href={getPanelUrl(effectiveThreadId)} />
      ) : (
        <Link
          to={getPanelUrl(effectiveThreadId)}
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          Reply in thread
        </Link>
      )
  }

  const threadFooter = !isThreadParentProp ? (
    <div className="mt-1 flex items-center gap-1.5 text-xs">
      {replyLink}
      {activityLabel && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <Link
            to={getTraceUrl(activity!.sessionId)}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            {activityLabel}
          </Link>
        </>
      )}
    </div>
  ) : null

  const { toggleByEmoji } = useMessageReactions(workspaceId, payload.messageId)
  const handleAddReaction = useCallback(
    (emoji: string) => toggleByEmoji(emoji, payload.reactions ?? {}, currentUserId),
    [toggleByEmoji, payload.reactions, currentUserId]
  )

  const activeReactionShortcodes = useMemo(() => {
    if (!currentUserId || !payload.reactions) return new Set<string>()
    const active = new Set<string>()
    for (const [shortcode, userIds] of Object.entries(payload.reactions)) {
      if (userIds.includes(currentUserId)) {
        active.add(stripColons(shortcode))
      }
    }
    return active
  }, [currentUserId, payload.reactions])

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await messageService.delete(workspaceId, payload.messageId)
      setDeleteDialogOpen(false)
    } catch {
      // Enqueue for retry when back online
      await enqueueOperation(workspaceId, "delete_message", { messageId: payload.messageId })
      setDeleteDialogOpen(false)
      toast.info("Delete queued — will complete when back online")
    } finally {
      setIsDeleting(false)
    }
  }

  // Shared action context for both desktop dropdown and mobile drawer
  const actionContext = useMemo(
    () => ({
      contentMarkdown: payload.contentMarkdown,
      actorType: event.actorType,
      sessionId: payload.sessionId,
      isThreadParent: panelId === threadId || isThreadParentProp,
      replyUrl: effectiveThreadId ? getPanelUrl(effectiveThreadId) : draftPanelUrl,
      traceUrl:
        event.actorType === "persona" && payload.sessionId
          ? getTraceUrl(payload.sessionId, payload.messageId)
          : undefined,
      messageId: payload.messageId,
      workspaceId,
      streamId,
      authorId: event.actorId ?? undefined,
      currentUserId: currentUserId ?? undefined,
      editedAt: payload.editedAt,
      onEdit: startEditing,
      onDelete: () => setDeleteDialogOpen(true),
      // Deferred to next tick so the DropdownMenu/ActionDrawer fully unmounts
      // before the Dialog opens — Radix emits synthetic pointer events on menu
      // close that trigger the Dialog's "click outside" handler otherwise.
      onShowHistory: () => setTimeout(() => setHistoryOpen(true), 0),
      onReact: handleAddReaction,
      onOpenFullPicker: () => setMobilePickerOpen(true),
      reactions: payload.reactions,
    }),
    [
      payload.contentMarkdown,
      payload.sessionId,
      payload.messageId,
      payload.editedAt,
      payload.reactions,
      event.actorType,
      event.actorId,
      panelId,
      threadId,
      isThreadParentProp,
      effectiveThreadId,
      getPanelUrl,
      draftPanelUrl,
      getTraceUrl,
      currentUserId,
      workspaceId,
      streamId,
      startEditing,
      handleAddReaction,
    ]
  )

  return (
    <>
      <MessageLayout
        event={event}
        payload={payload}
        workspaceId={workspaceId}
        actorName={actorName}
        actorInitials={actorInitials}
        personaSlug={personaSlug}
        actorAvatarUrl={actorAvatarUrl}
        statusIndicator={
          <>
            <RelativeTime date={event.createdAt} className="text-xs text-muted-foreground" />
            {payload.editedAt && (
              <EditedIndicator editedAt={payload.editedAt} onShowHistory={() => setHistoryOpen(true)} />
            )}
          </>
        }
        isEditing={isEditing && !isMobile}
        actions={
          // Desktop: hover-reveal dropdown menu. Mobile: hidden (long-press opens drawer instead).
          <div
            className={cn(
              "opacity-0 group-hover:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity ml-auto hidden sm:flex items-center gap-1",
              isEditing && "!opacity-0 pointer-events-none"
            )}
          >
            <ReactionEmojiPicker
              workspaceId={workspaceId}
              onSelect={handleAddReaction}
              activeShortcodes={activeReactionShortcodes}
            />
            <MessageContextMenu context={actionContext} />
          </div>
        }
        footer={
          isEditing && !isMobile ? undefined : (
            <>
              {payload.reactions && Object.keys(payload.reactions).length > 0 && (
                <MessageReactions
                  reactions={payload.reactions}
                  workspaceId={workspaceId}
                  messageId={payload.messageId}
                  currentUserId={currentUserId}
                />
              )}
              {threadFooter}
            </>
          )
        }
        containerRef={containerRef}
        isHighlighted={isHighlighted}
        isNew={isNew}
        deferSecondaryHydration={deferSecondaryHydration}
        containerClassName={cn(
          "scroll-mt-12",
          isMobile && !isEditing && "select-none",
          longPress.isPressed && "opacity-70 transition-opacity duration-100"
        )}
        touchHandlers={isMobile ? longPress.handlers : undefined}
      >
        {/* Desktop: inline edit replaces message content. Mobile: drawer handles editing. */}
        {isEditing && !isMobile ? (
          <MessageEditForm
            messageId={payload.messageId}
            workspaceId={workspaceId}
            initialContentJson={payload.contentJson}
            onSave={stopEditing}
            onCancel={stopEditing}
          />
        ) : undefined}
      </MessageLayout>
      {/* Mobile: edit in a bottom-sheet drawer (avoids scroll/keyboard issues) */}
      {isEditing && isMobile && (
        <MessageEditForm
          messageId={payload.messageId}
          workspaceId={workspaceId}
          initialContentJson={payload.contentJson}
          onSave={stopEditing}
          onCancel={stopEditing}
          authorName={actorName}
        />
      )}
      {deleteDialogOpen && (
        <DeleteMessageDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleDelete}
          isDeleting={isDeleting}
        />
      )}
      {historyOpen && (
        <MessageHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          messageId={payload.messageId}
          workspaceId={workspaceId}
          messageCreatedAt={event.createdAt}
          currentContent={{
            contentMarkdown: payload.contentMarkdown,
            editedAt: payload.editedAt,
          }}
        />
      )}
      {isMobile && (
        <MessageActionDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          context={actionContext}
          authorName={actorName}
        />
      )}
      {mobilePickerOpen && (
        <ReactionEmojiPicker
          workspaceId={workspaceId}
          onSelect={handleAddReaction}
          activeShortcodes={activeReactionShortcodes}
          open={mobilePickerOpen}
          onOpenChange={setMobilePickerOpen}
        />
      )}
    </>
  )
}

function PendingMessageEvent({
  event,
  payload,
  workspaceId,
  actorName,
  actorInitials,
  personaSlug,
  actorAvatarUrl,
  deferSecondaryHydration,
}: MessageEventInnerProps) {
  return (
    <MessageLayout
      event={event}
      payload={payload}
      workspaceId={workspaceId}
      actorName={actorName}
      actorInitials={actorInitials}
      personaSlug={personaSlug}
      actorAvatarUrl={actorAvatarUrl}
      deferSecondaryHydration={deferSecondaryHydration}
      containerClassName="opacity-60"
      statusIndicator={
        <span className="text-xs text-muted-foreground opacity-0 animate-fade-in-delayed">Sending...</span>
      }
    />
  )
}

function FailedMessageEvent({
  event,
  payload,
  workspaceId,
  actorName,
  actorInitials,
  personaSlug,
  actorAvatarUrl,
  deferSecondaryHydration,
}: MessageEventInnerProps) {
  const { retryMessage, deleteMessage } = usePendingMessages()

  return (
    <MessageLayout
      event={event}
      payload={payload}
      workspaceId={workspaceId}
      actorName={actorName}
      actorInitials={actorInitials}
      personaSlug={personaSlug}
      actorAvatarUrl={actorAvatarUrl}
      deferSecondaryHydration={deferSecondaryHydration}
      containerClassName="border-l-2 border-destructive pl-2"
      statusIndicator={<span className="text-xs text-destructive">Failed to send</span>}
      actions={
        <div className="flex gap-1 mt-1">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => retryMessage(event.id)}>
            Retry
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={() => deleteMessage(event.id)}
          >
            Delete
          </Button>
        </div>
      }
    />
  )
}

export function MessageEvent({
  event,
  workspaceId,
  streamId,
  isThreadParent,
  isHighlighted,
  isNew,
  activity,
  deferSecondaryHydration = false,
}: MessageEventProps) {
  const payload = event.payload as MessagePayload
  const { getStatus } = usePendingMessages()
  const { getActorName, getActorAvatar } = useActors(workspaceId)
  const status = getStatus(event.id)

  const actorName = getActorName(event.actorId, event.actorType)
  const {
    fallback: actorInitials,
    slug: personaSlug,
    avatarUrl: actorAvatarUrl,
  } = getActorAvatar(event.actorId, event.actorType)

  switch (status) {
    case "pending":
      return (
        <PendingMessageEvent
          event={event}
          payload={payload}
          workspaceId={workspaceId}
          streamId={streamId}
          actorName={actorName}
          actorInitials={actorInitials}
          personaSlug={personaSlug}
          actorAvatarUrl={actorAvatarUrl}
          deferSecondaryHydration={deferSecondaryHydration}
        />
      )
    case "failed":
      return (
        <FailedMessageEvent
          event={event}
          payload={payload}
          workspaceId={workspaceId}
          streamId={streamId}
          actorName={actorName}
          actorInitials={actorInitials}
          personaSlug={personaSlug}
          actorAvatarUrl={actorAvatarUrl}
          deferSecondaryHydration={deferSecondaryHydration}
        />
      )
    default:
      return (
        <SentMessageEvent
          event={event}
          payload={payload}
          workspaceId={workspaceId}
          streamId={streamId}
          actorName={actorName}
          actorInitials={actorInitials}
          personaSlug={personaSlug}
          actorAvatarUrl={actorAvatarUrl}
          isThreadParent={isThreadParent}
          isHighlighted={isHighlighted}
          isNew={isNew}
          activity={activity}
          deferSecondaryHydration={deferSecondaryHydration}
        />
      )
  }
}
