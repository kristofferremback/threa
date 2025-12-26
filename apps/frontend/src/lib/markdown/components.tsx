import type { Components } from "react-markdown"
import { Suspense, lazy, Component, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { processChildrenForMentions } from "./mention-renderer"

const CodeBlock = lazy(() => import("./code-block"))

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
  // Headers - scaled for message context, process @mentions and #channels
  h1: ({ children }) => (
    <h1 className="text-xl font-bold mt-4 mb-2 first:mt-0">{processChildrenForMentions(children)}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-bold mt-3 mb-2 first:mt-0">{processChildrenForMentions(children)}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold mt-3 mb-1 first:mt-0">{processChildrenForMentions(children)}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{processChildrenForMentions(children)}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-sm font-medium mt-2 mb-1 first:mt-0">{processChildrenForMentions(children)}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-sm font-medium text-muted-foreground mt-2 mb-1 first:mt-0">
      {processChildrenForMentions(children)}
    </h6>
  ),

  // Paragraphs - process @mentions and #channels
  p: ({ children }) => <p className="mb-2 last:mb-0">{processChildrenForMentions(children)}</p>,

  // Links - open in new tab
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-4 hover:text-primary/80"
    >
      {children}
    </a>
  ),

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

    // Inline code
    return <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
  },

  // Code blocks wrapper - let code component handle rendering
  pre: ({ children }) => <>{children}</>,

  // Bold
  strong: ({ children }) => <strong className="font-semibold">{processChildrenForMentions(children)}</strong>,

  // Italic
  em: ({ children }) => <em className="italic">{processChildrenForMentions(children)}</em>,

  // Strikethrough (GFM)
  del: ({ children }) => (
    <del className="line-through text-muted-foreground">{processChildrenForMentions(children)}</del>
  ),

  // Blockquote
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/50 pl-4 my-2 text-muted-foreground italic">{children}</blockquote>
  ),

  // Lists
  ul: ({ children }) => <ul className="list-disc pl-6 my-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-6 my-2">{children}</ol>,
  li: ({ children, className }) => {
    const isTaskItem = className?.includes("task-list-item")
    return <li className={cn("mb-1", isTaskItem && "list-none -ml-6")}>{processChildrenForMentions(children)}</li>
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
  th: ({ children }) => <TableHead>{processChildrenForMentions(children)}</TableHead>,
  td: ({ children }) => <TableCell>{processChildrenForMentions(children)}</TableCell>,

  // Horizontal rule
  hr: () => <hr className="my-4 border-border" />,

  // Images - render as links (no embedding for external URLs)
  img: ({ src, alt }) => (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-4 hover:text-primary/80"
    >
      {alt || src}
    </a>
  ),
}
