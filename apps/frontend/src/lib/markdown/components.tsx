import type { Components } from "react-markdown"
import { Suspense, lazy, Component, Children, isValidElement, type ReactNode, type MouseEvent } from "react"
import { parseQuoteHref, parseSharedMessageHref } from "@threa/prosemirror"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ProcessedChildren } from "./mention-renderer"
import { useAttachmentContext } from "./attachment-context"
import { useLinkPreviewContext } from "./link-preview-context"
import { QuoteReplyBlock } from "./quote-reply-block"
import { BlockquoteBlock } from "./blockquote-block"
import { SharedMessagePointerBlock } from "./shared-message-block"

const CodeBlock = lazy(() => import("./code-block"))

/**
 * Walk a react-markdown element tree for the first `<a>` whose href
 * passes the predicate, and return the predicate's parsed payload paired
 * with the link's plain-text content (which the serializer uses to
 * carry the human-readable author name).
 *
 * Used by both the quote-reply blockquote detection and the shared-message
 * paragraph swap — same traversal, different protocol — so the structural
 * rule lives in one place.
 */
function findFirstLink<T>(node: ReactNode, parseHref: (href: string) => T | null): (T & { linkText: string }) | null {
  if (!isValidElement(node)) return null

  const props = node.props as Record<string, unknown>
  if (typeof props.href === "string") {
    const parsed = parseHref(props.href)
    if (parsed) {
      return { ...parsed, linkText: extractTextFromChildren(props.children as ReactNode) }
    }
  }

  if (props.children) {
    for (const child of Children.toArray(props.children as ReactNode)) {
      const result = findFirstLink(child, parseHref)
      if (result) return result
    }
  }

  return null
}

/**
 * Detects whether a paragraph's children contain a shared-message pointer
 * link. The serializer produces a single-line paragraph containing exactly
 * one `shared-message:` anchor, so any paragraph carrying that link is
 * treated as a pointer.
 */
function findSharedMessageInChildren(
  children: ReactNode
): { streamId: string; messageId: string; authorName: string } | null {
  for (const child of Children.toArray(children)) {
    const match = findFirstLink(child, parseSharedMessageHref)
    if (match) return { streamId: match.streamId, messageId: match.messageId, authorName: match.linkText }
  }
  return null
}

/**
 * Walk a blockquote's children for a `quote:` attribution link. Returns
 * the parsed metadata plus the children that come before it (the actual
 * quoted content), or `null` if this is a regular blockquote.
 *
 * Iterates in reverse because the serializer always emits the attribution
 * as the last child paragraph: `<p>quoted text</p>…<p>— <a href="quote:…">Author</a></p>`.
 */
function extractQuoteReplyFromChildren(children: ReactNode): {
  authorName: string
  streamId: string
  messageId: string
  authorId: string
  actorType: string
  quotedContent: ReactNode[]
} | null {
  const childArray: ReactNode[] = Children.toArray(children)

  for (let i = childArray.length - 1; i >= 0; i--) {
    const child = childArray[i]
    if (!isValidElement(child)) continue

    const match = findFirstLink(child, parseQuoteHref)
    if (match) {
      return {
        authorName: match.linkText,
        streamId: match.streamId,
        messageId: match.messageId,
        authorId: match.authorId,
        actorType: match.actorType,
        quotedContent: childArray.slice(0, i),
      }
    }
  }

  return null
}

/**
 * Extract plain text from React children tree.
 */
function extractTextFromChildren(children: ReactNode): string {
  if (typeof children === "string") return children
  if (typeof children === "number") return String(children)
  if (!children) return ""
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join("")
  if (isValidElement(children)) {
    const props = children.props as Record<string, unknown>
    return extractTextFromChildren(props.children as ReactNode)
  }
  return ""
}

/**
 * Link component that handles attachment:// URLs specially
 */
function MarkdownLink({ href, children }: { href?: string; children: ReactNode }) {
  const attachmentContext = useAttachmentContext()
  const linkPreviewContext = useLinkPreviewContext()

  // Check if this is an attachment link
  if (href?.startsWith("attachment:")) {
    const attachmentId = href.replace("attachment:", "")

    const handleClick = (e: MouseEvent) => {
      e.preventDefault()
      attachmentContext?.openAttachment(attachmentId, e.metaKey || e.ctrlKey)
    }

    const handleMouseEnter = () => {
      attachmentContext?.setHoveredAttachmentId(attachmentId)
    }

    const handleMouseLeave = () => {
      attachmentContext?.setHoveredAttachmentId(null)
    }

    return (
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="break-all text-primary underline underline-offset-4 hover:text-primary/80 [&_span]:[text-decoration:inherit] cursor-pointer"
      >
        <ProcessedChildren>{children}</ProcessedChildren>
      </button>
    )
  }

  // Regular link — sync hover with link preview context
  const handleMouseEnter = () => {
    if (href) linkPreviewContext?.setHoveredLinkUrl(href)
  }

  const handleMouseLeave = () => {
    linkPreviewContext?.setHoveredLinkUrl(null)
  }

  // The message-level long-press hook skips its timer when the touch starts
  // inside an <a href> (via deferToNativeLinks: true), so long-press here gets
  // the native browser menu (e.g. "Open in Firefox", "Copy link") instead of
  // the message drawer.
  return (
    // break-all so long URLs wrap inside the message column instead of
    // forcing horizontal overflow (URLs rarely contain whitespace).
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="break-all text-primary underline underline-offset-4 hover:text-primary/80 [&_span]:[text-decoration:inherit]"
    >
      <ProcessedChildren>{children}</ProcessedChildren>
    </a>
  )
}

/**
 * Error boundary for lazy-loaded CodeBlock - falls back to plain code on load failure
 */
class CodeBlockErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

export const markdownComponents: Components = {
  // Headers - scaled for message context, process @mentions, #channels, and :emoji:
  h1: ({ children }) => (
    <h1 className="text-xl font-bold mt-4 mb-2 first:mt-0">
      <ProcessedChildren>{children}</ProcessedChildren>
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-bold mt-3 mb-2 first:mt-0">
      <ProcessedChildren>{children}</ProcessedChildren>
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold mt-3 mb-1 first:mt-0">
      <ProcessedChildren>{children}</ProcessedChildren>
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold mt-2 mb-1 first:mt-0">
      <ProcessedChildren>{children}</ProcessedChildren>
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-sm font-medium mt-2 mb-1 first:mt-0">
      <ProcessedChildren>{children}</ProcessedChildren>
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-sm font-medium text-muted-foreground mt-2 mb-1 first:mt-0">
      <ProcessedChildren>{children}</ProcessedChildren>
    </h6>
  ),

  // Paragraphs - process @mentions, #channels, and :emoji:. If the paragraph
  // carries a shared-message: anchor, swap the whole paragraph for the pointer
  // card (the serializer emits a single-line paragraph for each share, so
  // this lossless swap is always correct).
  p: ({ children }) => {
    const share = findSharedMessageInChildren(children)
    if (share) {
      return (
        <SharedMessagePointerBlock
          streamId={share.streamId}
          messageId={share.messageId}
          authorName={share.authorName}
        />
      )
    }
    return (
      <p className="mb-2 last:mb-0">
        <ProcessedChildren>{children}</ProcessedChildren>
      </p>
    )
  },

  // Links - handles both regular links and attachment:// URLs
  // [&_span] ensures inline-flex elements like TriggerChips inherit underline decoration
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,

  // Code - inline and blocks
  code: ({ className, children }) => {
    const isCodeBlock = className?.includes("language-")

    if (isCodeBlock) {
      const language = className?.replace("language-", "") || "text"
      const fallback = (
        <pre className="bg-muted rounded-md p-4 overflow-x-auto my-2">
          <code className="text-sm font-mono">{children}</code>
        </pre>
      )
      return (
        <CodeBlockErrorBoundary fallback={fallback}>
          <Suspense fallback={fallback}>
            <CodeBlock language={language}>{String(children)}</CodeBlock>
          </Suspense>
        </CodeBlockErrorBoundary>
      )
    }

    // Inline code — break-all so long identifiers, paths, or tokens inside
    // backticks wrap inside the message column instead of overflowing.
    return <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono break-all">{children}</code>
  },

  // Code blocks wrapper - let code component handle rendering
  pre: ({ children }) => <>{children}</>,

  // Bold
  strong: ({ children }) => (
    <strong className="font-semibold">
      <ProcessedChildren>{children}</ProcessedChildren>
    </strong>
  ),

  // Italic
  em: ({ children }) => (
    <em className="italic">
      <ProcessedChildren>{children}</ProcessedChildren>
    </em>
  ),

  // Strikethrough (GFM) - [&_span] ensures inline-flex elements like TriggerChips inherit decoration
  del: ({ children }) => (
    <del className="line-through text-muted-foreground [&_span]:[text-decoration:inherit]">
      <ProcessedChildren>{children}</ProcessedChildren>
    </del>
  ),

  // Blockquote — detect quote-reply attribution pattern (quote: protocol link)
  blockquote: ({ children }) => {
    const quoteReply = extractQuoteReplyFromChildren(children)
    if (quoteReply) {
      return (
        <QuoteReplyBlock
          authorName={quoteReply.authorName}
          authorId={quoteReply.authorId}
          actorType={quoteReply.actorType}
          streamId={quoteReply.streamId}
          messageId={quoteReply.messageId}
        >
          {quoteReply.quotedContent}
        </QuoteReplyBlock>
      )
    }
    return <BlockquoteBlock>{children}</BlockquoteBlock>
  },

  // Lists
  ul: ({ children }) => <ul className="list-disc pl-6 my-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-6 my-2">{children}</ol>,
  li: ({ children, className }) => {
    const isTaskItem = className?.includes("task-list-item")
    return (
      <li className={cn("mb-1", isTaskItem && "list-none -ml-6")}>
        <ProcessedChildren>{children}</ProcessedChildren>
      </li>
    )
  },

  // Task list checkboxes (read-only)
  input: ({ type, checked }) => {
    if (type === "checkbox") {
      return <Checkbox checked={checked} disabled className="mr-2 align-middle cursor-default" />
    }
    return null
  },

  // Tables - use Shadcn UI Table
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <Table>{children}</Table>
    </div>
  ),
  thead: ({ children }) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => (
    <TableHead>
      <ProcessedChildren>{children}</ProcessedChildren>
    </TableHead>
  ),
  td: ({ children }) => (
    <TableCell>
      <ProcessedChildren>{children}</ProcessedChildren>
    </TableCell>
  ),

  // Horizontal rule
  hr: () => <hr className="my-4 border-border" />,

  // Images - render as links (no embedding for external URLs)
  img: ({ src, alt }) => (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-primary underline underline-offset-4 hover:text-primary/80"
    >
      {alt || src}
    </a>
  ),
}
