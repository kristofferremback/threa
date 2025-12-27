import { memo } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import { markdownComponents } from "@/lib/markdown/components"
import { MentionProvider } from "@/lib/markdown/mention-context"
import { useMentionables } from "@/hooks/use-mentionables"

interface MarkdownContentProps {
  content: string
  className?: string
}

export const MarkdownContent = memo(function MarkdownContent({ content, className }: MarkdownContentProps) {
  const { mentionables } = useMentionables()

  return (
    <MentionProvider mentionables={mentionables}>
      <div className={cn("markdown-content", className)}>
        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {content}
        </Markdown>
      </div>
    </MentionProvider>
  )
})
