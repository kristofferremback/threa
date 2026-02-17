import type { ComponentType } from "react"
import { Sparkles, MessageSquareReply, Copy, FileText, Type } from "lucide-react"
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
  label: string
  icon: ComponentType<{ className?: string }>
  /** Sub-actions turn this item into a sub-menu with variants */
  subActions?: MessageSubAction[]
  /** Render a separator before this action in the menu */
  separatorBefore?: boolean
  /** Controls visibility — evaluated by getVisibleActions */
  when: (context: MessageActionContext) => boolean
  /** URL for navigation actions — rendered as <Link> (INV-40) */
  getHref?: (context: MessageActionContext) => string | undefined
  /** Handler for mutation actions — rendered as <button> */
  action?: (context: MessageActionContext) => void | Promise<void>
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
]

/** Filter actions that should be shown for a given message context. */
export function getVisibleActions(context: MessageActionContext): MessageAction[] {
  return messageActions.filter((a) => a.when(context))
}
