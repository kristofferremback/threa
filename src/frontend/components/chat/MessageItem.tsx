import { useState, useRef, useEffect } from "react"
import {
  MessageCircle,
  PanelRightOpen,
  Pencil,
  X,
  Check,
  MoreHorizontal,
  Hash,
  Forward,
  Loader2,
  AlertCircle,
  RotateCcw,
} from "lucide-react"
import { Avatar, RelativeTime } from "../ui"
import { MessageContextMenu } from "./MessageContextMenu"
import { MessageRevisionsModal } from "./MessageRevisionsModal"
import { MessageContent, type MessageMention } from "./MessageContent"
import { RichTextEditor, type RichTextEditorRef } from "./RichTextEditor"
import type { Message, OpenMode, LinkedChannel, SharedFromInfo } from "../../types"
import { getOpenMode, getDisplayName } from "../../types"
import type { AgentSession } from "./AgentThinkingEvent"

interface MessageItemProps {
  message: Message
  workspaceId: string
  currentChannelId?: string
  isOwnMessage?: boolean
  isRead?: boolean
  isServerRead?: boolean
  isHighlighted?: boolean
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  onEdit?: (messageId: string, newContent: string) => Promise<void>
  onMarkAsRead?: (messageId: string) => void
  onMarkAsUnread?: (messageId: string) => void
  onShareToChannel?: (messageId: string) => Promise<void>
  onCrosspostToChannel?: (messageId: string) => void // Opens channel selector
  onUserMentionClick?: (userId: string) => void
  onChannelClick?: (channelSlug: string, e: React.MouseEvent) => void
  onRetryMessage?: (messageId: string) => void
  animationDelay?: number
  showThreadActions?: boolean
  visibilityRef?: React.RefObject<HTMLDivElement> | ((el: HTMLDivElement | null) => void)
  users?: Array<{ id: string; name: string; email: string }>
  channels?: Array<{ id: string; name: string; slug: string | null }>
  /** Session triggered by this message (for showing inline thinking badge) */
  agentSession?: AgentSession
  /** Whether the session is in a different stream (thread) - if true, show badge */
  sessionInThread?: boolean
}

export function MessageItem({
  message,
  workspaceId,
  currentChannelId,
  isOwnMessage = false,
  isRead = true,
  isServerRead = true,
  isHighlighted = false,
  onOpenThread,
  onEdit,
  onMarkAsRead,
  onMarkAsUnread,
  onShareToChannel,
  onCrosspostToChannel,
  onUserMentionClick,
  onChannelClick,
  onRetryMessage,
  animationDelay = 0,
  showThreadActions = true,
  visibilityRef,
  users = [],
  channels = [],
  agentSession,
  sessionInThread = false,
}: MessageItemProps) {
  const isPending = message.pending
  const isFailed = message.sendFailed
  const hasReplies = message.replyCount && message.replyCount > 0
  // Show thinking badge if session is active and NOT in the currently viewed stream
  // This shows when viewing a parent channel for a session happening in a thread
  const showThinkingBadge =
    agentSession &&
    currentChannelId &&
    agentSession.streamId !== currentChannelId &&
    (agentSession.status === "active" || agentSession.status === "summarizing")

  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.message)
  const [isSaving, setIsSaving] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [showRevisions, setShowRevisions] = useState(false)
  const editorRef = useRef<RichTextEditorRef>(null)

  useEffect(() => {
    if (isEditing && editorRef.current) {
      editorRef.current.focus()
    }
  }, [isEditing])

  const handleStartEdit = () => {
    setEditContent(message.message)
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditContent(message.message)
  }

  const handleSaveEdit = async () => {
    const content = editorRef.current?.getContent()?.trim()
    if (!onEdit || !content || content === message.message) {
      handleCancelEdit()
      return
    }

    setIsSaving(true)
    try {
      await onEdit(message.id, content)
      setIsEditing(false)
    } catch {
      // Error handled in onEdit
    } finally {
      setIsSaving(false)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenu({ x: rect.right, y: rect.bottom })
  }

  // Handle both RefObject and callback ref types
  const setRef = (el: HTMLDivElement | null) => {
    if (typeof visibilityRef === "function") {
      visibilityRef(el)
    } else if (visibilityRef) {
      ;(visibilityRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    }
  }

  // Determine background color based on state
  const getBackground = () => {
    if (isHighlighted) return "var(--highlight-bg, rgba(250, 204, 21, 0.15))"
    if (isEditing) return "var(--hover-overlay)"
    if (!isRead) return "var(--unread-bg)"
    return undefined
  }

  // Determine border color based on state
  const getBorderLeft = () => {
    if (isHighlighted) return "3px solid var(--highlight-border, rgb(250, 204, 21))"
    if (!isRead) return "3px solid var(--accent-primary)"
    return "3px solid transparent"
  }

  return (
    <div
      ref={setRef}
      className={`group mb-1 rounded-lg p-3 -mx-2 animate-fade-in ${isHighlighted ? "highlight-pulse" : "transition-colors"}`}
      style={{
        animationDelay: `${animationDelay}ms`,
        background: getBackground(),
        borderLeft: getBorderLeft(),
      }}
      onMouseEnter={(e) =>
        !isEditing &&
        !isHighlighted &&
        (e.currentTarget.style.background = isRead ? "var(--hover-overlay)" : "var(--unread-bg-hover)")
      }
      onMouseLeave={(e) =>
        !isEditing && (e.currentTarget.style.background = !isRead ? "var(--unread-bg)" : "transparent")
      }
      onContextMenu={handleContextMenu}
    >
      <div className="mb-1 flex items-center gap-2">
        <Avatar name={getDisplayName(message.name, message.email)} size="sm" />
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {getDisplayName(message.name, message.email)}
        </span>
        <RelativeTime
          date={message.timestamp}
          className="text-xs"
          style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
        />

        {/* Pending/Failed status indicator */}
        {isPending && (
          <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <Loader2 className="h-3 w-3 animate-spin" />
            Sending...
          </span>
        )}
        {isFailed && (
          <span className="flex items-center gap-1 text-xs" style={{ color: "var(--warning, #f59e0b)" }}>
            <RotateCcw className="h-3 w-3" />
            Will retry automatically
            {onRetryMessage && (
              <button
                onClick={() => onRetryMessage(message.id)}
                className="flex items-center gap-0.5 ml-1 hover:underline"
                style={{ color: "var(--accent-primary)" }}
              >
                Retry now
              </button>
            )}
          </span>
        )}

        {message.isEdited && message.updatedAt && (
          <button
            onClick={() => setShowRevisions(true)}
            className="text-xs transition-colors hover:underline"
            style={{ color: "var(--text-muted)" }}
            title="View edit history"
          >
            (edited <RelativeTime date={message.updatedAt} addSuffix={false} /> ago)
          </button>
        )}

        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {isOwnMessage && !isEditing && onEdit && (
            <button
              onClick={handleStartEdit}
              className="p-1 rounded"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay-strong)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              title="Edit message"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={handleMoreClick}
            className="p-1 rounded"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay-strong)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            title="More actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="pl-8">
        {isEditing ? (
          <div
            className="flex flex-col gap-2"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                handleCancelEdit()
              }
            }}
          >
            <RichTextEditor
              ref={editorRef}
              initialContent={message.message}
              initialMentions={message.mentions?.map((m) => ({
                type: m.type,
                id: m.id,
                label: m.label,
                slug: m.slug,
              }))}
              placeholder="Edit message..."
              disabled={isSaving}
              onSubmit={handleSaveEdit}
              onChange={setEditContent}
              users={users}
              channels={channels}
              autofocus
            />
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <span>Press Enter to save, Escape to cancel</span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={handleCancelEdit}
                  className="p-1.5 rounded transition-colors"
                  style={{ color: "var(--text-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay-strong)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  disabled={isSaving}
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="p-1.5 rounded transition-colors"
                  style={{ color: "var(--success)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay-strong)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  disabled={isSaving}
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {message.sharedFrom && (
              <SharedFromBadge sharedFrom={message.sharedFrom} onChannelClick={onChannelClick} channels={channels} />
            )}
            <MessageContent
              content={message.message}
              mentions={message.mentions as MessageMention[] | undefined}
              onUserMentionClick={onUserMentionClick}
              onChannelClick={onChannelClick}
            />
          </>
        )}

        {/* Multi-channel badges */}
        {message.linkedChannels && message.linkedChannels.length > 1 && (
          <ChannelBadges
            channels={message.linkedChannels}
            currentChannelId={currentChannelId}
            onChannelClick={onChannelClick}
          />
        )}
      </div>

      {showThreadActions && !isEditing && (
        <div className="pl-8 mt-2">
          {hasReplies || showThinkingBadge ? (
            <div className="flex items-center gap-3">
              {/* Reply count */}
              {hasReplies && (
                <button
                  onClick={(e) => onOpenThread?.(message.id, message.channelId, getOpenMode(e))}
                  className="text-xs flex items-center gap-1.5 transition-colors hover:underline"
                  style={{ color: "var(--accent-primary)" }}
                  title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  <span className="font-medium">
                    {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
                  </span>
                </button>
              )}

              {/* Agent thinking badge - inline with reply count */}
              {showThinkingBadge && agentSession && (
                <span
                  className="text-xs flex items-center gap-1.5"
                  style={{ color: "var(--accent-secondary, #8b5cf6)" }}
                >
                  {agentSession.personaAvatar && (
                    <span className="text-sm">{agentSession.personaAvatar}</span>
                  )}
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="font-medium">{agentSession.personaName || "Ariadne"} is thinking</span>
                </span>
              )}

              {/* Side panel button */}
              <button
                onClick={() => onOpenThread?.(message.id, message.channelId, "side")}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay-strong)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                title="Open thread to side"
              >
                <PanelRightOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
              <button
                onClick={(e) => onOpenThread?.(message.id, message.channelId, getOpenMode(e))}
                className="text-xs flex items-center gap-1 transition-colors hover:underline"
                style={{ color: "var(--accent-primary)" }}
                title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
              >
                <MessageCircle className="h-3 w-3" />
                Reply in thread
              </button>
              <button
                onClick={() => onOpenThread?.(message.id, message.channelId, "side")}
                className="p-1 rounded"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-overlay-strong)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                title="Open thread to side"
              >
                <PanelRightOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isOwnMessage={isOwnMessage}
          hasConversation={Boolean(message.conversationId)}
          isEdited={Boolean(message.isEdited)}
          isRead={isServerRead}
          isThreadReply={Boolean(message.replyToMessageId || message.conversationId)}
          isAlreadySharedToChannel={Boolean(message.linkedChannels?.some((c) => c.id === message.channelId))}
          onClose={() => setContextMenu(null)}
          onEdit={isOwnMessage && onEdit ? handleStartEdit : undefined}
          onShowRevisions={message.isEdited ? () => setShowRevisions(true) : undefined}
          onReplyInThread={() => onOpenThread?.(message.id, message.channelId, "replace")}
          onShareToChannel={
            (message.replyToMessageId || message.conversationId) && onShareToChannel
              ? () => onShareToChannel(message.id)
              : undefined
          }
          onCrosspostToChannel={onCrosspostToChannel ? () => onCrosspostToChannel(message.id) : undefined}
          onMarkAsRead={onMarkAsRead ? () => onMarkAsRead(message.id) : undefined}
          onMarkAsUnread={onMarkAsUnread ? () => onMarkAsUnread(message.id) : undefined}
        />
      )}

      {showRevisions && (
        <MessageRevisionsModal
          isOpen={showRevisions}
          onClose={() => setShowRevisions(false)}
          messageId={message.id}
          currentContent={message.message}
          authorEmail={message.email}
          workspaceId={workspaceId}
        />
      )}
    </div>
  )
}

// Channel badges component for multi-channel conversations
interface ChannelBadgesProps {
  channels: LinkedChannel[]
  currentChannelId?: string
  onChannelClick?: (channelSlug: string, e: React.MouseEvent) => void
}

function ChannelBadges({ channels, currentChannelId, onChannelClick }: ChannelBadgesProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        In:
      </span>
      {channels.map((channel) => {
        const isCurrent = channel.id === currentChannelId
        return (
          <button
            key={channel.id}
            onClick={(e) => !isCurrent && onChannelClick?.(channel.slug, e)}
            disabled={isCurrent}
            title={isCurrent ? undefined : "Click to open, ⌥+click to open to side, ⌘+click for new tab"}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium transition-colors"
            style={{
              // Current channel: warm amber/gold, Other channels: neutral with blue hover
              background: isCurrent ? "rgba(245, 158, 11, 0.15)" : "var(--bg-tertiary)",
              color: isCurrent ? "rgb(245, 158, 11)" : "var(--text-secondary)",
              cursor: isCurrent ? "default" : "pointer",
              border: isCurrent ? "1px solid rgba(245, 158, 11, 0.3)" : "1px solid transparent",
            }}
            onMouseEnter={(e) => {
              if (!isCurrent) {
                e.currentTarget.style.background = "var(--accent-primary-muted)"
                e.currentTarget.style.color = "var(--accent-primary)"
              }
            }}
            onMouseLeave={(e) => {
              if (!isCurrent) {
                e.currentTarget.style.background = "var(--bg-tertiary)"
                e.currentTarget.style.color = "var(--text-secondary)"
              }
            }}
          >
            <Hash className="w-3 h-3" />
            {channel.slug}
          </button>
        )
      })}
    </div>
  )
}

// Shared from badge for cross-posted messages
interface SharedFromBadgeProps {
  sharedFrom: SharedFromInfo
  channels?: Array<{ id: string; name: string; slug: string | null }>
  onChannelClick?: (channelSlug: string, e: React.MouseEvent) => void
}

function SharedFromBadge({ sharedFrom, channels, onChannelClick }: SharedFromBadgeProps) {
  const sourceChannel = channels?.find((c) => c.id === sharedFrom.streamId)
  const sourceSlug = sourceChannel?.slug
  const sourceName = sourceChannel?.name || "another channel"
  const actorName = getDisplayName(sharedFrom.actorName, sharedFrom.actorEmail)

  return (
    <div
      className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded text-xs"
      style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}
    >
      <Forward className="w-3 h-3" />
      <span>Shared by {actorName} from</span>
      {sourceSlug ? (
        <button
          onClick={(e) => onChannelClick?.(sourceSlug, e)}
          className="inline-flex items-center gap-0.5 font-medium transition-colors hover:underline"
          style={{ color: "var(--accent-primary)" }}
          title="Click to open, ⌥+click to open to side, ⌘+click for new tab"
        >
          <Hash className="w-3 h-3" />
          {sourceSlug}
        </button>
      ) : (
        <span className="font-medium">{sourceName}</span>
      )}
    </div>
  )
}
