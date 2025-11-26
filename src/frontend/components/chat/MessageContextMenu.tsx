import { createPortal } from "react-dom"
import { Pencil, Bell, Smile, Pin, Share2, MessageCircle, History, Check, Circle, Send, Hash } from "lucide-react"

interface MessageContextMenuProps {
  x: number
  y: number
  isOwnMessage: boolean
  hasConversation: boolean
  isEdited: boolean
  isRead: boolean
  isThreadReply: boolean // Whether this message is a reply in a thread
  isAlreadySharedToChannel: boolean // Whether already shared to channel
  onClose: () => void
  onEdit?: () => void
  onShowRevisions?: () => void
  onFollowConversation?: () => void
  onAddReaction?: () => void
  onPinMessage?: () => void
  onShareToChannel?: () => void // Share thread reply to parent channel
  onCrosspostToChannel?: () => void // Cross-post to another channel
  onReplyInThread?: () => void
  onMarkAsRead?: () => void
  onMarkAsUnread?: () => void
}

interface MenuItemProps {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  shortcut?: string
}

function MenuItem({ icon, label, onClick, disabled = false, shortcut }: MenuItemProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className="w-full text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors"
      style={{
        color: disabled ? "var(--text-muted)" : "var(--text-primary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.background = "var(--hover-overlay)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      disabled={disabled}
    >
      <span style={{ color: disabled ? "var(--text-muted)" : "var(--text-tertiary)" }}>{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {shortcut}
        </span>
      )}
      {disabled && (
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}
        >
          Soon
        </span>
      )}
    </button>
  )
}

function MenuDivider() {
  return <div className="my-1" style={{ borderTop: "1px solid var(--border-subtle)" }} />
}

export function MessageContextMenu({
  x,
  y,
  isOwnMessage,
  hasConversation,
  isEdited,
  isRead,
  isThreadReply,
  isAlreadySharedToChannel,
  onClose,
  onEdit,
  onShowRevisions,
  onFollowConversation,
  onAddReaction,
  onPinMessage,
  onShareToChannel,
  onCrosspostToChannel,
  onReplyInThread,
  onMarkAsRead,
  onMarkAsUnread,
}: MessageContextMenuProps) {
  const menuWidth = 220
  const menuHeight = 320
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 8)
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 8)

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9998]"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        className="fixed z-[9999] py-1 rounded-lg shadow-lg min-w-[200px]"
        style={{
          top: adjustedY,
          left: adjustedX,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <MenuItem
          icon={<MessageCircle className="h-4 w-4" />}
          label="Reply in thread"
          onClick={() => {
            onReplyInThread?.()
            onClose()
          }}
        />

        <MenuDivider />

        {isOwnMessage && (
          <MenuItem
            icon={<Pencil className="h-4 w-4" />}
            label="Edit message"
            shortcut="E"
            onClick={() => {
              onEdit?.()
              onClose()
            }}
          />
        )}

        {isEdited && (
          <MenuItem
            icon={<History className="h-4 w-4" />}
            label="View edit history"
            onClick={() => {
              onShowRevisions?.()
              onClose()
            }}
          />
        )}

        <MenuItem icon={<Smile className="h-4 w-4" />} label="Add reaction" disabled />

        <MenuDivider />

        <MenuItem
          icon={<Bell className="h-4 w-4" />}
          label={hasConversation ? "Follow thread" : "Get notified"}
          disabled
        />

        <MenuItem icon={<Pin className="h-4 w-4" />} label="Pin message" disabled />

        <MenuDivider />

        {/* Sharing options */}
        {isThreadReply && !isAlreadySharedToChannel && (
          <MenuItem
            icon={<Send className="h-4 w-4" />}
            label="Send to channel"
            onClick={() => {
              onShareToChannel?.()
              onClose()
            }}
          />
        )}

        {isThreadReply && isAlreadySharedToChannel && (
          <MenuItem icon={<Send className="h-4 w-4" />} label="Already in channel" disabled />
        )}

        <MenuItem
          icon={<Hash className="h-4 w-4" />}
          label="Cross-post to channel..."
          onClick={() => {
            onCrosspostToChannel?.()
            onClose()
          }}
        />

        <MenuDivider />

        {isRead ? (
          <MenuItem
            icon={<Circle className="h-4 w-4" />}
            label="Mark as unread"
            onClick={() => {
              onMarkAsUnread?.()
              onClose()
            }}
          />
        ) : (
          <MenuItem
            icon={<Check className="h-4 w-4" />}
            label="Mark as read"
            onClick={() => {
              onMarkAsRead?.()
              onClose()
            }}
          />
        )}
      </div>
    </>,
    document.body,
  )
}
