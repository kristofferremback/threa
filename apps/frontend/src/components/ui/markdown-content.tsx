import { memo, type ReactNode } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import { markdownComponents } from "@/lib/markdown/components"
import { MentionProvider } from "@/lib/markdown/mention-context"
import { AttachmentProvider } from "@/lib/markdown/attachment-context"
import type { Mentionable } from "@/components/editor/triggers/types"

export { AttachmentProvider }

interface MarkdownContentProps {
  content: string
  className?: string
}

/**
 * URL transformer that allows attachment: URLs to pass through.
 * By default, react-markdown strips unrecognized protocols.
 */
function urlTransform(url: string): string {
  // Allow attachment: protocol for inline file references
  if (url.startsWith("attachment:")) {
    return url
  }
  // For other URLs, use default behavior (returns url as-is for http/https/mailto)
  const protocols = ["http:", "https:", "mailto:", "tel:"]
  const parsed = url.includes(":") ? url.split(":")[0] + ":" : ""
  if (protocols.includes(parsed) || url.startsWith("/") || url.startsWith("#")) {
    return url
  }
  return ""
}

/**
 * Basic markdown renderer without mention context.
 * Uses fallback mention styling (all mentions styled as users).
 */
export const MarkdownContent = memo(function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn("markdown-content", className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={urlTransform}>
        {content}
      </Markdown>
    </div>
  )
})

interface MarkdownWithMentionsProps {
  content: string
  className?: string
  mentionables: Mentionable[]
}

/**
 * Markdown renderer with mention context for correct styling.
 * Wraps content with MentionProvider to enable "me" highlighting and proper mention types.
 */
export function MarkdownWithMentions({ content, className, mentionables }: MarkdownWithMentionsProps) {
  return (
    <MentionProvider mentionables={mentionables}>
      <MarkdownContent content={content} className={className} />
    </MentionProvider>
  )
}

interface MentionableMarkdownWrapperProps {
  children: ReactNode
  mentionables: Mentionable[]
}

/**
 * Wrapper that provides mention context to its children.
 * Use this to wrap areas where messages are rendered to enable correct mention styling.
 */
export function MentionableMarkdownWrapper({ children, mentionables }: MentionableMarkdownWrapperProps) {
  return <MentionProvider mentionables={mentionables}>{children}</MentionProvider>
}
