import { memo, type ReactNode } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import { markdownComponents } from "@/lib/markdown/components"
import { MentionProvider } from "@/lib/markdown/mention-context"
import type { Mentionable } from "@/components/editor/triggers/types"

interface MarkdownContentProps {
  content: string
  className?: string
}

/**
 * Basic markdown renderer without mention context.
 * Uses fallback mention styling (all mentions styled as users).
 */
export const MarkdownContent = memo(function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn("markdown-content", className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
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
