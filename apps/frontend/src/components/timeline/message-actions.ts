import type { ComponentType } from "react"
import {
  Sparkles,
  MessageSquareReply,
  Quote,
  Copy,
  FileText,
  Type,
  Pencil,
  Trash2,
  History,
  Link2,
  Bookmark,
  BookmarkX,
  Bell,
  Share2,
} from "lucide-react"
import { toast } from "sonner"
import { stripMarkdown } from "@/lib/markdown"

/**
 * Context available to message actions.
 * Mirrors the Command pattern used in quick-switcher/commands.ts.
 */
export interface MessageActionContext {
  contentMarkdown: string
  actorType: string | null
  sessionId?: string
  /** Whether this message is the parent of the currently open thread panel */
  isThreadParent?: boolean
  /** URL for "reply in thread" */
  replyUrl: string
  /** URL for "show trace" (only for persona messages) */
  traceUrl?: string
  /** Message ID for edit/delete operations */
  messageId?: string
  /** Workspace ID for reaction API calls */
  workspaceId?: string
  /** Stream ID for constructing permalink URLs */
  streamId?: string
  /** Author's user ID */
  authorId?: string
  /** Current user's user ID */
  currentUserId?: string
  /** Whether this message has been edited */
  editedAt?: string
  /** Callback to enter edit mode */
  onEdit?: () => void
  /** Callback to open delete confirmation */
  onDelete?: () => void
  /** Callback to open edit history */
  onShowHistory?: () => void
  /** Callback to add a reaction (emoji character) */
  onReact?: (emoji: string) => void
  /** Callback to open the full emoji picker (used by mobile drawer to lift picker out) */
  onOpenFullPicker?: () => void
  /** Current reactions on this message (shortcode → userIds) for toggle logic */
  reactions?: Record<string, string[]>
  /** Callback to insert a quote reply into the composer */
  onQuoteReply?: () => void
  /** Callback to insert a partial quote reply with a user-selected snippet */
  onQuoteReplyWithSnippet?: (snippet: string) => void
  /**
   * Share-to-parent fast path: queue a pointer share into the parent stream's
   * composer and navigate there. Only present when the message is in a thread
   * whose parent is a top-level stream.
   */
  onShareToParent?: () => void
  /** Label text for the share-to-parent entry, e.g. "Share to #general" or "Share to DM" */
  shareToParentLabel?: string
  /** Callback to save or unsave the message */
  onToggleSave?: () => void
  /** Callback to open the reminder picker (mobile: bottom sheet) */
  onRequestReminder?: () => void
  /** Whether the message is currently saved by the viewer */
  isSaved?: boolean
}

/** A variant within a sub-menu (e.g. "Copy as Markdown" vs "Copy as Plain text"). */
export interface MessageSubAction {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  action: (context: MessageActionContext) => void | Promise<void>
}

/** A top-level action in the message context menu. */
export interface MessageAction {
  id: string
  /**
   * Visible menu label. Plain string for static entries; for actions whose
   * label depends on the message (e.g. "Share to #parent-name"), pass a
   * function that derives it from the context.
   */
  label: string | ((context: MessageActionContext) => string)
  icon: ComponentType<{ className?: string }>
  /** Sub-actions turn this item into a sub-menu with variants */
  subActions?: MessageSubAction[]
  /** Render a separator before this action in the menu */
  separatorBefore?: boolean
  /** Visual variant — "destructive" renders in red */
  variant?: "destructive"
  /** Controls visibility — evaluated by getVisibleActions */
  when: (context: MessageActionContext) => boolean
  /** URL for navigation actions — rendered as <Link> (INV-40) */
  getHref?: (context: MessageActionContext) => string | undefined
  /** Handler for mutation actions — rendered as <button> */
  action?: (context: MessageActionContext) => void | Promise<void>
}

/** Resolve the visible label for an action, handling the string/function variants. */
export function resolveActionLabel(action: MessageAction, context: MessageActionContext): string {
  return typeof action.label === "function" ? action.label(context) : action.label
}

// --- Helpers ---

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

// --- Action definitions ---

export const messageActions: MessageAction[] = [
  {
    id: "show-trace",
    label: "Show trace and sources",
    icon: Sparkles,
    when: (ctx) => ctx.actorType === "persona" && !!ctx.sessionId && !!ctx.traceUrl,
    getHref: (ctx) => ctx.traceUrl,
  },
  {
    id: "reply-in-thread",
    label: "Reply in thread",
    icon: MessageSquareReply,
    when: (ctx) => !ctx.isThreadParent,
    getHref: (ctx) => ctx.replyUrl,
  },
  {
    id: "quote-reply",
    label: "Quote reply",
    icon: Quote,
    when: (ctx) => !!ctx.onQuoteReply,
    action: (ctx) => ctx.onQuoteReply?.(),
  },
  {
    id: "share-to-parent",
    label: (ctx) => ctx.shareToParentLabel ?? "Share to parent",
    icon: Share2,
    when: (ctx) => !!ctx.onShareToParent,
    action: (ctx) => ctx.onShareToParent?.(),
  },
  {
    // Split into two rows (save / unsave) so the menu entry always matches
    // the action that will fire — a single "Save for later" row on an
    // already-saved message was misleading and silently unsaved things.
    id: "save-message",
    label: "Save for later",
    icon: Bookmark,
    when: (ctx) => !!ctx.onToggleSave && !ctx.isSaved,
    action: (ctx) => ctx.onToggleSave?.(),
  },
  {
    id: "unsave-message",
    label: "Remove from Saved",
    icon: BookmarkX,
    when: (ctx) => !!ctx.onToggleSave && !!ctx.isSaved,
    action: (ctx) => ctx.onToggleSave?.(),
  },
  {
    id: "set-reminder",
    // Mobile hover can't show the desktop popover, so mobile users get a
    // dedicated drawer entry that opens a bottom sheet with presets + a
    // custom-time dialog.
    label: "Set reminder…",
    icon: Bell,
    when: (ctx) => !!ctx.onRequestReminder,
    action: (ctx) => ctx.onRequestReminder?.(),
  },
  {
    id: "edit-message",
    label: "Edit message",
    icon: Pencil,
    when: (ctx) => ctx.actorType === "user" && !!ctx.authorId && ctx.authorId === ctx.currentUserId,
    action: (ctx) => ctx.onEdit?.(),
  },
  {
    id: "see-revisions",
    label: "See revisions",
    icon: History,
    when: (ctx) => !!ctx.editedAt,
    action: (ctx) => ctx.onShowHistory?.(),
  },
  {
    id: "copy",
    label: "Copy as Markdown",
    icon: Copy,
    separatorBefore: true,
    subActions: [
      {
        id: "copy-markdown",
        label: "Copy as Markdown",
        icon: FileText,
        action: async (ctx) => {
          try {
            await copyToClipboard(ctx.contentMarkdown)
            toast.success("Copied as Markdown")
          } catch {
            toast.error("Failed to copy")
          }
        },
      },
      {
        id: "copy-plain-text",
        label: "Copy as Plain text",
        icon: Type,
        action: async (ctx) => {
          try {
            await copyToClipboard(stripMarkdown(ctx.contentMarkdown))
            toast.success("Copied as plain text")
          } catch {
            toast.error("Failed to copy")
          }
        },
      },
    ],
    when: () => true,
  },
  {
    id: "copy-link",
    label: "Copy link to message",
    icon: Link2,
    when: (ctx) => !!ctx.messageId && !!ctx.workspaceId && !!ctx.streamId,
    action: async (ctx) => {
      try {
        const url = `${window.location.origin}/w/${ctx.workspaceId}/s/${ctx.streamId}?m=${ctx.messageId}`
        await copyToClipboard(url)
        toast.success("Link copied")
      } catch {
        toast.error("Failed to copy link")
      }
    },
  },
  {
    id: "delete-message",
    label: "Delete message",
    icon: Trash2,
    separatorBefore: true,
    variant: "destructive",
    when: (ctx) => ctx.actorType === "user" && !!ctx.authorId && ctx.authorId === ctx.currentUserId,
    action: (ctx) => ctx.onDelete?.(),
  },
]

/** Filter actions that should be shown for a given message context. */
export function getVisibleActions(context: MessageActionContext): MessageAction[] {
  return messageActions.filter((a) => a.when(context))
}
