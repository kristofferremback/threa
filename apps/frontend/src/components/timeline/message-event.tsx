import { type ReactNode, useRef, useEffect, useState, useMemo, useCallback } from "react"
import {
  isSentViaApi,
  type StreamEvent,
  type AttachmentSummary,
  type JSONContent,
  type LinkPreviewSummary,
  type ThreadSummary,
} from "@threa/types"
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
import { useFormattedDate } from "@/hooks/use-formatted-date"
import { useEditLastMessage } from "./edit-last-message-context"
import {
  useActors,
  useWorkspaceUserId,
  useMessageReactions,
  stripColons,
  focusAtEnd,
  type MessageAgentActivity,
} from "@/hooks"
import { Quote } from "lucide-react"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { useLongPress } from "@/hooks/use-long-press"
import { AttachmentList } from "./attachment-list"
import { LinkPreviewList } from "./link-preview-list"
import { LinkPreviewProvider, useLinkPreviewContext } from "@/lib/markdown/link-preview-context"
import { MessageContextMenu } from "./message-context-menu"
import { SaveMessageButton } from "./save-message-button"
import { ReminderPickerSheet } from "./reminder-picker-sheet"
import { useSavedForMessage, useSaveMessage, useDeleteSaved } from "@/hooks/use-saved"
import { MessageActionDrawer } from "./message-action-drawer"
import { ThreadCard } from "./thread-card"
import { ActivityPill } from "./activity-pill"
import { DeleteMessageDialog } from "./delete-message-dialog"
import { MessageEditForm } from "./message-edit-form"
import { UnsentMessageEditForm } from "./unsent-message-edit-form"
import { UnsentMessageActionDrawer } from "./unsent-message-action-drawer"
import { EditedIndicator } from "./edited-indicator"
import { SavedIndicator } from "@/components/saved/saved-indicator"
import { MessageHistoryDialog } from "./message-history-dialog"
import { MessageReactions } from "./message-reactions"
import { ReactionEmojiPicker } from "./reaction-emoji-picker"
import { useQuoteReply } from "./quote-reply-context"
import { useSwipeAction } from "@/hooks/use-swipe-action"

interface MessagePayload {
  messageId: string
  contentMarkdown: string
  contentJson?: JSONContent
  attachments?: AttachmentSummary[]
  linkPreviews?: LinkPreviewSummary[]
  replyCount?: number
  threadId?: string
  /**
   * Aggregated latest-reply preview + participants. Populated by bootstrap
   * enrichment for messages with ≥1 non-deleted reply. Consumed by ThreadCard.
   */
  threadSummary?: ThreadSummary
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
  /**
   * When true, render as a same-author continuation: drop the header row,
   * show only the gutter micro-time and body. `MessageLayout` ignores this
   * in pending/failed/editing states so those always render with a full
   * header.
   */
  groupContinuation?: boolean
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
  /**
   * Inline action buttons rendered in the header row (pending/failed/editing
   * states). Suppressed on continuations, where the header row is collapsed.
   * Desktop hover actions for sent messages live in `hoverActions` instead.
   */
  actions?: ReactNode
  /**
   * Absolute-positioned hover toolbar for sent messages. Floated above the
   * message row so it works identically on heads and continuations without
   * competing with inline layout. Renderer hides on touch devices.
   */
  hoverActions?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  containerClassName?: string
  isHighlighted?: boolean
  isNew?: boolean
  isEditing?: boolean
  /**
   * Render as a same-author continuation: no header row, 32px gutter column
   * holding a compact HH:mm stamp instead of the avatar. Ignored when the
   * layout is already in edit mode (the edit form needs its full column).
   */
  isGroupContinuation?: boolean
  containerRef?: React.RefObject<HTMLDivElement | null>
  deferSecondaryHydration?: boolean
  /** Touch event handlers for mobile long-press */
  touchHandlers?: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchEnd: () => void
    onTouchMove: (e: React.TouchEvent) => void
    onContextMenu: (e: React.MouseEvent) => void
  }
  /** Horizontal swipe offset for mobile swipe-to-quote (px, negative = left) */
  swipeOffset?: number
  /** Whether swipe has passed the threshold */
  swipeLocked?: boolean
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
  hoverActions,
  footer,
  children,
  containerClassName,
  isHighlighted,
  isNew,
  isEditing,
  isGroupContinuation,
  containerRef,
  deferSecondaryHydration,
  touchHandlers,
  swipeOffset,
  swipeLocked,
}: MessageLayoutProps) {
  const isPersona = event.actorType === "persona"
  const isSystem = event.actorType === "system"
  const isBot = event.actorType === "bot"
  const isUser = event.actorType === "user"
  const { openUserProfile } = useUserProfile()
  const { formatTime, formatFull } = useFormattedDate()

  // Edit mode needs the full content column (author row + status indicator) so the
  // edit form's buttons have somewhere coherent to sit. Force head layout even
  // when the grouping pass marked this row as a continuation.
  const renderAsContinuation = isGroupContinuation && !isEditing

  const hasSwipe = swipeOffset !== undefined && swipeOffset !== 0
  const messageBody = children ?? (
    <LinkPreviewProvider>
      <AttachmentProvider workspaceId={workspaceId} attachments={payload.attachments ?? []}>
        <MarkdownContent
          content={payload.contentMarkdown}
          messageId={payload.messageId}
          className="text-sm leading-relaxed"
        />
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
  )

  const sentAt = new Date(event.createdAt)
  const gutterLabel = formatTime(sentAt)
  const gutterTitle = formatFull(sentAt)

  let avatarSlot: ReactNode
  if (renderAsContinuation) {
    avatarSlot = (
      <div
        className={cn(
          "message-avatar-spacer flex h-5 w-8 shrink-0 items-start justify-end pr-1",
          "font-mono text-[10px] tabular-nums leading-5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors"
        )}
        aria-label={`sent at ${gutterLabel}`}
        title={gutterTitle}
      >
        {gutterLabel}
      </div>
    )
  } else if (isPersona) {
    avatarSlot = (
      <PersonaAvatar
        slug={personaSlug}
        fallback={actorInitials}
        size="md"
        className="message-avatar h-8 w-8 rounded-[8px]"
      />
    )
  } else {
    avatarSlot = (
      <Avatar className="message-avatar h-8 w-8 rounded-[8px] shrink-0">
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
    )
  }

  return (
    <div
      ref={containerRef}
      data-author-name={actorName}
      data-author-id={event.actorId ?? ""}
      data-actor-type={event.actorType ?? "user"}
      data-group-continuation={renderAsContinuation ? "true" : undefined}
      className={cn("relative overflow-hidden", containerClassName)}
      // Continuations collapse the visible author row, so surface the author for
      // screen readers via the row's accessible name. Heads already have a
      // visible author label so we leave aria-label unset there.
      aria-label={renderAsContinuation ? `Message from ${actorName}` : undefined}
      {...touchHandlers}
    >
      {/* Swipe-to-quote reveal icon (behind the message) */}
      {hasSwipe && (
        <div className="absolute inset-y-0 right-0 flex items-center pr-4">
          <Quote className={cn("h-5 w-5 transition-colors", swipeLocked ? "text-primary" : "text-muted-foreground")} />
        </div>
      )}
      <div
        className={cn(
          // Opaque background so swipe-to-quote icon shows behind the message
          "message-item group relative flex gap-3 px-3 sm:px-6 bg-background",
          // Continuations collapse the vertical padding so the run reads as one turn.
          renderAsContinuation ? "py-0.5" : "py-3",
          // AI/Persona messages get full-width gradient with gold accent
          isPersona && "bg-gradient-to-r from-primary/[0.06] to-transparent shadow-[inset_3px_0_0_hsl(var(--primary))]",
          // Bot messages get emerald accent
          isBot && "bg-gradient-to-r from-emerald-500/[0.06] to-transparent shadow-[inset_3px_0_0_hsl(152_69%_41%)]",
          // System messages get a subtle info-toned accent
          isSystem && "bg-gradient-to-r from-blue-500/[0.04] to-transparent shadow-[inset_3px_0_0_hsl(210_100%_55%)]",
          // Edit mode: pseudo-element background so no layout shift — zero padding/margin changes
          isEditing &&
            !isPersona &&
            !isBot &&
            !isSystem &&
            "before:content-[''] before:absolute before:-top-4 before:-bottom-4 before:left-0 before:right-0 before:bg-primary/[0.04] before:-z-10",
          isHighlighted && "animate-highlight-flash",
          isNew && !isHighlighted && "animate-new-message-fade"
        )}
        style={hasSwipe ? { transform: `translateX(${swipeOffset}px)` } : undefined}
      >
        {avatarSlot}
        <div className="message-content flex-1 min-w-0">
          {!renderAsContinuation && (
            <div className="flex items-baseline gap-2 mb-0.5">
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
          )}
          {messageBody}
          {footer}
        </div>
        {hoverActions && (
          <div
            className={cn(
              // Floats at the top of the row so hover interactions on heads and
              // continuations share the same toolbar. The 20px upward overlap keeps
              // the toolbar readable on py-0.5 continuations without pushing past
              // the viewport — on heads (py-3) it sits just above the header row.
              "pointer-events-none absolute right-4 z-10 hidden sm:block",
              "bottom-[calc(100%-20px)] opacity-0 group-hover:pointer-events-auto group-hover:opacity-100",
              "has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100",
              "transition-opacity",
              isEditing && "pointer-events-none opacity-0"
            )}
          >
            <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-popover/95 px-1 py-1 shadow-md backdrop-blur-sm">
              {hoverActions}
            </div>
          </div>
        )}
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
  /**
   * See MessageEventProps.groupContinuation. Honored by SentMessageEvent and
   * PendingMessageEvent so the optimistic → confirmed transition on send
   * doesn't flip a mid-run message from head to continuation. Ignored by
   * FailedMessageEvent (keeps the "Failed to send" status + Retry/Edit/Delete
   * inline actions visible) and EditingMessageEvent (the edit form needs the
   * full content column).
   */
  groupContinuation?: boolean
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
  groupContinuation,
}: MessageEventInnerProps) {
  const { panelId, getPanelUrl } = usePanel()
  const messageService = useMessageService()
  const currentUserId = useWorkspaceUserId(workspaceId)
  const { getTraceUrl } = useTrace()
  const quoteReplyCtx = useQuoteReply()
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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const longPress = useLongPress({
    onLongPress: openDrawer,
    enabled: isMobile && !isEditing,
    deferToNativeLinks: true,
  })

  // Mobile: swipe left to quote reply
  const handleSwipeQuote = useCallback(() => {
    const snippet = payload.contentMarkdown.trim()
    if (!snippet) return
    quoteReplyCtx?.triggerQuoteReply({
      messageId: payload.messageId,
      streamId,
      authorName: actorName,
      authorId: event.actorId ?? "",
      actorType: event.actorType ?? "user",
      snippet,
    })
  }, [quoteReplyCtx, payload.messageId, payload.contentMarkdown, streamId, actorName, event.actorId, event.actorType])
  const swipe = useSwipeAction({
    onSwipe: handleSwipeQuote,
    enabled: isMobile && !isEditing && !!quoteReplyCtx,
  })

  const startEditing = useCallback(() => {
    setIsEditing(true)
  }, [])

  // Restore focus to the zone's editor after exiting inline edit mode.
  // On mobile the stream composer is hidden purely via CSS while MessageEditForm
  // keeps a `[data-inline-edit]` element mounted, so there is no extra flag to
  // reset here.
  const stopEditing = useCallback(() => {
    const zone = containerRef.current?.closest<HTMLElement>("[data-editor-zone]") ?? null
    setIsEditing(false)
    if (isMobile) return
    requestAnimationFrame(() => focusVisibleZoneEditor(zone))
  }, [isMobile])

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

  // Thread card shown below the message body when a thread exists with replies.
  // Users without a thread start one via the hover toolbar or context menu —
  // the old always-visible "Reply in thread" footer link has been removed.
  // `activity.threadStreamId` lets us link to the real thread immediately when
  // an agent response is in flight, before the slower stream:created event.
  const effectiveThreadId = threadId ?? activity?.threadStreamId
  // Thread slot below the body. Prefers the card as soon as the thread has
  // any replies so a mid-session "thread created" moment doesn't shuffle
  // between pill and card. The activity indicator lives inside the card via
  // `isActive`, so `pill → card → pill-off` reduces to `card-active →
  // card-idle` (no layout change). When there are no replies yet, the pill
  // is still the lightweight stand-in for the not-yet-created thread.
  let threadSlot: ReactNode = null
  if (!isThreadParentProp && effectiveThreadId && replyCount > 0) {
    threadSlot = (
      <ThreadCard
        replyCount={replyCount}
        href={getPanelUrl(effectiveThreadId)}
        workspaceId={workspaceId}
        summary={payload.threadSummary}
        isActive={!!activity}
      />
    )
  } else if (!isThreadParentProp && activity) {
    threadSlot = <ActivityPill activity={activity} className="mt-2" />
  }

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

  const savedForMessage = useSavedForMessage(workspaceId, payload.messageId)
  const saveMessageMutation = useSaveMessage(workspaceId)
  const unsaveMessageMutation = useDeleteSaved(workspaceId)
  const isSaved = !!savedForMessage && savedForMessage.status === "saved"
  const [reminderSheetOpen, setReminderSheetOpen] = useState(false)

  const handleToggleSave = useCallback(() => {
    // Mirror the desktop hover-button: swallow double-taps while a mutation is
    // in flight and surface a toast on every outcome so the mobile drawer
    // gives the same feedback as the desktop bookmark button.
    if (saveMessageMutation.isPending || unsaveMessageMutation.isPending) return
    if (!savedForMessage) {
      saveMessageMutation.mutate(
        { messageId: payload.messageId },
        {
          onSuccess: () => toast.success("Saved for later"),
          onError: () => toast.error("Could not save message"),
        }
      )
      return
    }
    if (savedForMessage.status !== "saved") {
      saveMessageMutation.mutate(
        { messageId: payload.messageId },
        {
          onSuccess: () => toast.success("Moved back to Saved"),
          onError: () => toast.error("Could not restore saved item"),
        }
      )
      return
    }
    unsaveMessageMutation.mutate(savedForMessage.id, {
      onSuccess: () => toast.success("Removed from saved"),
      onError: () => toast.error("Could not remove saved item"),
    })
  }, [savedForMessage, saveMessageMutation, unsaveMessageMutation, payload.messageId])

  const handleRequestReminder = useCallback(() => setReminderSheetOpen(true), [])

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
      isSaved,
      onToggleSave: handleToggleSave,
      onRequestReminder: handleRequestReminder,
      onQuoteReply: quoteReplyCtx
        ? () =>
            quoteReplyCtx.triggerQuoteReply({
              messageId: payload.messageId,
              streamId,
              authorName: actorName,
              authorId: event.actorId ?? "",
              actorType: event.actorType ?? "user",
              snippet: payload.contentMarkdown,
            })
        : undefined,
      onQuoteReplyWithSnippet: quoteReplyCtx
        ? (snippet: string) =>
            quoteReplyCtx.triggerQuoteReply({
              messageId: payload.messageId,
              streamId,
              authorName: actorName,
              authorId: event.actorId ?? "",
              actorType: event.actorType ?? "user",
              snippet,
            })
        : undefined,
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
      quoteReplyCtx,
      actorName,
      isSaved,
      handleToggleSave,
      handleRequestReminder,
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
            <SavedIndicator saved={savedForMessage ?? null} />
          </>
        }
        isEditing={isEditing && !isMobile}
        isGroupContinuation={groupContinuation}
        hoverActions={
          // Desktop-only hover toolbar floated above the row. Mobile users reach
          // these actions via the long-press drawer (MessageActionDrawer).
          <>
            <ReactionEmojiPicker
              workspaceId={workspaceId}
              onSelect={handleAddReaction}
              activeShortcodes={activeReactionShortcodes}
            />
            <SaveMessageButton workspaceId={workspaceId} messageId={payload.messageId} />
            {actionContext.onQuoteReply && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground shrink-0 hover:text-foreground"
                    aria-label="Quote reply"
                    onClick={actionContext.onQuoteReply}
                  >
                    <Quote className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Quote reply</TooltipContent>
              </Tooltip>
            )}
            <MessageContextMenu context={actionContext} />
          </>
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
              {threadSlot}
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
        swipeOffset={isMobile ? swipe.offset : undefined}
        swipeLocked={isMobile ? swipe.isLocked : undefined}
        touchHandlers={
          isMobile
            ? {
                onTouchStart: (e: React.TouchEvent) => {
                  longPress.handlers.onTouchStart(e)
                  swipe.handlers.onTouchStart(e)
                },
                onTouchEnd: () => {
                  longPress.handlers.onTouchEnd()
                  swipe.handlers.onTouchEnd()
                },
                onTouchMove: (e: React.TouchEvent) => {
                  longPress.handlers.onTouchMove(e)
                  swipe.handlers.onTouchMove(e)
                },
                onContextMenu: longPress.handlers.onContextMenu,
              }
            : undefined
        }
      >
        {/* Desktop: inline edit replaces message content. Mobile: drawer handles editing. */}
        {isEditing && !isMobile ? (
          <MessageEditForm
            messageId={payload.messageId}
            workspaceId={workspaceId}
            initialContentJson={payload.contentJson}
            onSave={stopEditing}
            onCancel={stopEditing}
            onDelete={() => {
              stopEditing()
              setDeleteDialogOpen(true)
            }}
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
          onDelete={() => {
            stopEditing()
            setDeleteDialogOpen(true)
          }}
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
      {reminderSheetOpen && (
        <ReminderPickerSheet
          open={reminderSheetOpen}
          onOpenChange={setReminderSheetOpen}
          workspaceId={workspaceId}
          messageId={payload.messageId}
          saved={savedForMessage ?? null}
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
  groupContinuation,
}: MessageEventInnerProps) {
  const { markEditing, deleteMessage } = usePendingMessages()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const longPress = useLongPress({ onLongPress: openDrawer, enabled: isMobile, deferToNativeLinks: true })

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
        deferSecondaryHydration={deferSecondaryHydration}
        isGroupContinuation={groupContinuation}
        containerClassName={cn(
          "opacity-60",
          isMobile && "select-none",
          longPress.isPressed && "opacity-40 transition-opacity duration-100"
        )}
        touchHandlers={isMobile ? longPress.handlers : undefined}
        statusIndicator={
          <span className="text-xs text-muted-foreground opacity-0 animate-fade-in-delayed">Sending...</span>
        }
        actions={
          <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:flex">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void markEditing(event.id)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={() => void deleteMessage(event.id)}
            >
              Delete
            </Button>
          </div>
        }
        footer={null}
      />
      {isMobile && (
        <UnsentMessageActionDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          contentMarkdown={payload.contentMarkdown}
          authorName={actorName}
          onEdit={() => void markEditing(event.id)}
          onDelete={() => void deleteMessage(event.id)}
        />
      )}
    </>
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
  const { retryMessage, markEditing, deleteMessage } = usePendingMessages()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const longPress = useLongPress({ onLongPress: openDrawer, enabled: isMobile, deferToNativeLinks: true })

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
        deferSecondaryHydration={deferSecondaryHydration}
        containerClassName={cn(
          "border-l-2 border-destructive pl-2",
          isMobile && "select-none",
          longPress.isPressed && "opacity-70 transition-opacity duration-100"
        )}
        touchHandlers={isMobile ? longPress.handlers : undefined}
        statusIndicator={<span className="text-xs text-destructive">Failed to send</span>}
        actions={
          <div className="flex gap-1 mt-1 hidden sm:flex">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void retryMessage(event.id)}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void markEditing(event.id)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={() => void deleteMessage(event.id)}
            >
              Delete
            </Button>
          </div>
        }
        footer={null}
      />
      {isMobile && (
        <UnsentMessageActionDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          contentMarkdown={payload.contentMarkdown}
          authorName={actorName}
          onRetry={() => void retryMessage(event.id)}
          onEdit={() => void markEditing(event.id)}
          onDelete={() => void deleteMessage(event.id)}
        />
      )}
    </>
  )
}

function EditingMessageEvent({
  event,
  payload,
  workspaceId,
  actorName,
  actorInitials,
  personaSlug,
  actorAvatarUrl,
  deferSecondaryHydration,
}: MessageEventInnerProps) {
  const isMobile = useIsMobile()
  const containerRef = useRef<HTMLDivElement>(null)

  const stopEditing = useCallback(() => {
    const zone = containerRef.current?.closest<HTMLElement>("[data-editor-zone]") ?? null
    if (isMobile) return
    requestAnimationFrame(() => focusVisibleZoneEditor(zone))
  }, [isMobile])

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
        deferSecondaryHydration={deferSecondaryHydration}
        isEditing={!isMobile}
        containerRef={containerRef}
        statusIndicator={<span className="text-xs text-muted-foreground">Editing unsent message</span>}
      >
        {!isMobile ? (
          <UnsentMessageEditForm messageId={event.id} initialContentJson={payload.contentJson} onDone={stopEditing} />
        ) : undefined}
      </MessageLayout>
      {isMobile && (
        <UnsentMessageEditForm
          messageId={event.id}
          initialContentJson={payload.contentJson}
          onDone={stopEditing}
          authorName={actorName}
        />
      )}
    </>
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
  groupContinuation = false,
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
          isThreadParent={isThreadParent}
          deferSecondaryHydration={deferSecondaryHydration}
          groupContinuation={groupContinuation}
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
          isThreadParent={isThreadParent}
          deferSecondaryHydration={deferSecondaryHydration}
        />
      )
    case "editing":
      return (
        <EditingMessageEvent
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
          groupContinuation={groupContinuation}
        />
      )
  }
}
