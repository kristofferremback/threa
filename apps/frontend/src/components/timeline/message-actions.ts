import type { ComponentType } from "react"
import { Sparkles, MessageSquareReply, Copy, FileText, Type } from "lucide-react"
import { toast } from "sonner"

/**
 * Context available to message actions.
 * Mirrors the Command pattern used in quick-switcher/commands.ts.
 */
export interface MessageActionContext {
  contentMarkdown: string
  actorType: string | null
  sessionId?: string
  /** URL for "reply in thread" */
  replyUrl: string
  /** URL for "show trace" (only for persona messages) */
  traceUrl?: string
}

export interface MessageAction {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** Sub-actions turn this item into a dropdown with variants (e.g. "Copy as Markdown | Plain text") */
  subActions?: MessageAction[]
  when: (context: MessageActionContext) => boolean
  /** URL for navigation actions — rendered as <Link> (INV-40) */
  getHref?: (context: MessageActionContext) => string | undefined
  /** Handler for mutation actions — rendered as <button> */
  action?: (context: MessageActionContext) => void | Promise<void>
}

// --- Helpers ---

function stripMarkdown(md: string): string {
  return (
    md
      // Remove code blocks (fenced) — extract inner content
      .replace(/```[\s\S]*?```/g, (match) => {
        const lines = match.split("\n")
        return lines.slice(1, -1).join("\n")
      })
      // Remove headers
      .replace(/^#{1,6}\s+/gm, "")
      // Remove bold/italic
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
      .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
      // Remove inline code
      .replace(/`([^`]+)`/g, "$1")
      // Remove links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove images
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      // Remove blockquotes
      .replace(/^>\s?/gm, "")
      // Remove horizontal rules
      .replace(/^---+$/gm, "")
      // Clean up extra whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )
}

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

// --- Action definitions ---

export const messageActions: MessageAction[] = [
  {
    id: "show-trace",
    label: "Show trace and sources",
    icon: Sparkles,
    when: (ctx) => ctx.actorType === "persona" && !!ctx.sessionId,
    getHref: (ctx) => ctx.traceUrl,
  },
  {
    id: "reply-in-thread",
    label: "Reply in thread",
    icon: MessageSquareReply,
    when: () => true,
    getHref: (ctx) => ctx.replyUrl,
  },
  {
    id: "copy",
    label: "Copy as Markdown",
    icon: Copy,
    subActions: [
      {
        id: "copy-markdown",
        label: "Copy as Markdown",
        icon: FileText,
        when: () => true,
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
        when: () => true,
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
    async action(ctx) {
      // Default: copy as markdown (same as first sub-action)
      try {
        await copyToClipboard(ctx.contentMarkdown)
        toast.success("Copied as Markdown")
      } catch {
        toast.error("Failed to copy")
      }
    },
  },
]

/** Filter actions that should be shown for a given message context. */
export function getVisibleActions(context: MessageActionContext): MessageAction[] {
  return messageActions.filter((a) => a.when(context))
}
