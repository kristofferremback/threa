import { useState, useRef, useEffect } from "react"
import { MessageCircle, PanelRightOpen, Pencil, X, Check, MoreHorizontal } from "lucide-react"
import { Avatar, RelativeTime } from "../ui"
import { MessageContextMenu } from "./MessageContextMenu"
import { MessageRevisionsModal } from "./MessageRevisionsModal"
import type { Message, OpenMode } from "../../types"
import { getOpenMode } from "../../types"

interface MessageItemProps {
  message: Message
  workspaceId: string
  isOwnMessage?: boolean
  onOpenThread?: (messageId: string, channelId: string, mode: OpenMode) => void
  onEdit?: (messageId: string, newContent: string) => Promise<void>
  onMarkAsRead?: (messageId: string) => void
  onMarkAsUnread?: (messageId: string) => void
  animationDelay?: number
  showThreadActions?: boolean
  visibilityRef?: React.RefObject<HTMLDivElement>
}

export function MessageItem({
  message,
  workspaceId,
  isOwnMessage = false,
  onOpenThread,
  onEdit,
  onMarkAsRead,
  onMarkAsUnread,
  animationDelay = 0,
  showThreadActions = true,
  visibilityRef,
}: MessageItemProps) {
  const hasReplies = message.replyCount && message.replyCount > 0
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.message)
  const [isSaving, setIsSaving] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [showRevisions, setShowRevisions] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.setSelectionRange(editContent.length, editContent.length)
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
    if (!onEdit || editContent.trim() === message.message || !editContent.trim()) {
      handleCancelEdit()
      return
    }

    setIsSaving(true)
    try {
      await onEdit(message.id, editContent.trim())
      setIsEditing(false)
    } catch {
      // Error handled in onEdit
    } finally {
      setIsSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancelEdit()
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSaveEdit()
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

  return (
    <div
      ref={visibilityRef}
      className="group mb-1 rounded-lg p-3 -mx-2 transition-colors animate-fade-in"
      style={{ animationDelay: `${animationDelay}ms`, background: isEditing ? "var(--hover-overlay)" : undefined }}
      onMouseEnter={(e) => !isEditing && (e.currentTarget.style.background = "var(--hover-overlay)")}
      onMouseLeave={(e) => !isEditing && (e.currentTarget.style.background = "transparent")}
      onContextMenu={handleContextMenu}
    >
      <div className="mb-1 flex items-center gap-2">
        <Avatar name={message.email} size="sm" />
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {message.email}
        </span>
        <RelativeTime
          date={message.timestamp}
          className="text-xs"
          style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
        />
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
          <div className="flex flex-col gap-2">
            <textarea
              ref={inputRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full px-3 py-2 text-sm rounded-md resize-none"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
                outline: "none",
              }}
              rows={Math.min(editContent.split("\n").length + 1, 6)}
              disabled={isSaving}
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
                  disabled={isSaving || !editContent.trim() || editContent.trim() === message.message}
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
            {message.message}
          </div>
        )}
      </div>

      {showThreadActions && !isEditing && (
        <div className="pl-8 mt-2">
          {hasReplies ? (
            <div className="flex items-center gap-2">
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
          onClose={() => setContextMenu(null)}
          onEdit={isOwnMessage && onEdit ? handleStartEdit : undefined}
          onShowRevisions={message.isEdited ? () => setShowRevisions(true) : undefined}
          onReplyInThread={() => onOpenThread?.(message.id, message.channelId, "replace")}
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
