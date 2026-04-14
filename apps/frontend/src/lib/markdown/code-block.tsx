import { useEffect, useState, useCallback, useMemo } from "react"
import { codeToHtml } from "shiki"
import { useLiveQuery } from "dexie-react-hooks"
import { Copy, Check, ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { db } from "@/db"
import { DEFAULT_CODE_BLOCK_COLLAPSE_THRESHOLD } from "@threa/types"
import { usePreferences } from "@/contexts/preferences-context"
import { useCodeBlockMessageContext, hashCodeBlock } from "./code-block-context"

interface CodeBlockProps {
  language: string
  children: string
}

/** Format language name for display */
function formatLanguage(lang: string): string {
  const displayNames: Record<string, string> = {
    javascript: "JavaScript",
    typescript: "TypeScript",
    python: "Python",
    java: "Java",
    go: "Go",
    rust: "Rust",
    cpp: "C++",
    csharp: "C#",
    ruby: "Ruby",
    php: "PHP",
    swift: "Swift",
    kotlin: "Kotlin",
    html: "HTML",
    css: "CSS",
    scss: "SCSS",
    json: "JSON",
    yaml: "YAML",
    xml: "XML",
    markdown: "Markdown",
    sql: "SQL",
    bash: "Bash",
    shell: "Shell",
    dockerfile: "Dockerfile",
    graphql: "GraphQL",
    plaintext: "Plain text",
  }
  return displayNames[lang] || lang
}

function countLines(text: string): number {
  const trimmed = text.replace(/\n+$/, "")
  if (trimmed.length === 0) return 0
  let count = 1
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) === 10) count++
  }
  return count
}

export default function CodeBlock({ language, children }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const messageContext = useCodeBlockMessageContext()
  // Preferences context may not exist in all rendering contexts (e.g. tests).
  const preferencesContext = usePreferencesOptional()
  const threshold = preferencesContext?.preferences?.codeBlockCollapseThreshold ?? DEFAULT_CODE_BLOCK_COLLAPSE_THRESHOLD

  const trimmedCode = useMemo(() => children.trim(), [children])
  const lineCount = useMemo(() => countLines(trimmedCode), [trimmedCode])
  const defaultCollapsed = lineCount > threshold

  const collapseKey = useMemo(() => {
    if (!messageContext) return null
    return `${messageContext.messageId}:${hashCodeBlock(trimmedCode, language)}`
  }, [messageContext, trimmedCode, language])

  // Live-read the persisted collapse override (if any). undefined = no override.
  const persistedOverride = useLiveQuery(async () => {
    if (!collapseKey) return undefined
    const row = await db.codeBlockCollapse.get(collapseKey)
    return row?.collapsed
  }, [collapseKey])

  const collapsed = persistedOverride ?? defaultCollapsed

  const handleToggle = useCallback(async () => {
    if (!collapseKey || !messageContext) return
    const next = !collapsed
    // Persisted row always wins over threshold default once a user acts.
    await db.codeBlockCollapse.put({
      id: collapseKey,
      messageId: messageContext.messageId,
      blockIndex: 0,
      collapsed: next,
      updatedAt: Date.now(),
    })
  }, [collapseKey, messageContext, collapsed])

  const handleCopy = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation()
      try {
        await navigator.clipboard.writeText(trimmedCode)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // Clipboard API failed, silently ignore
      }
    },
    [trimmedCode]
  )

  useEffect(() => {
    // Skip expensive highlighting while collapsed.
    if (collapsed) return
    let cancelled = false

    codeToHtml(trimmedCode, {
      lang: language,
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: false,
    })
      .then((result) => {
        if (!cancelled) {
          setHtml(result)
        }
      })
      .catch(() => {
        // Fallback to plain code on error (unknown language, etc.)
        if (!cancelled) {
          setHtml(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [trimmedCode, language, collapsed])

  const canToggle = Boolean(collapseKey)
  const toggleLabel = collapsed ? `Expand ${lineCount} line${lineCount === 1 ? "" : "s"}` : "Collapse code block"

  const header = (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 bg-muted/50",
        collapsed ? "border-b border-transparent" : "border-b border-border"
      )}
    >
      <button
        type="button"
        onClick={handleToggle}
        disabled={!canToggle}
        aria-expanded={!collapsed}
        aria-label={toggleLabel}
        title={toggleLabel}
        className={cn(
          "flex items-center gap-1 min-w-0 flex-1 text-left",
          "text-[11px] font-medium text-muted-foreground font-mono",
          canToggle ? "hover:text-foreground cursor-pointer" : "cursor-default",
          "disabled:cursor-default"
        )}
      >
        {canToggle &&
          (collapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
          ))}
        <span className="truncate">{formatLanguage(language)}</span>
        {collapsed && (
          <span className="text-muted-foreground/80 font-normal shrink-0">
            — {lineCount} line{lineCount === 1 ? "" : "s"}, click to expand
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded transition-all duration-150 shrink-0",
          "opacity-0 group-hover:opacity-100",
          copied
            ? "bg-green-500/15 text-green-600 dark:text-green-400"
            : "text-muted-foreground hover:bg-primary/15 hover:text-primary"
        )}
        title={copied ? "Copied!" : "Copy code"}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  )

  if (collapsed) {
    return <div className="group my-2 rounded-md overflow-hidden border border-border bg-muted/50">{header}</div>
  }

  if (!html) {
    return (
      <div className="group my-2 rounded-md overflow-hidden border border-border bg-muted/50">
        {header}
        <pre className="px-2.5 py-2 overflow-x-auto">
          <code className="text-xs font-mono leading-snug">{children}</code>
        </pre>
      </div>
    )
  }

  return (
    <div className="group my-2 rounded-md overflow-hidden border border-border bg-muted/50">
      {header}
      <div
        className="[&>pre]:px-2.5 [&>pre]:py-2 [&>pre]:text-xs [&>pre]:leading-snug [&>pre]:overflow-x-auto [&>pre]:bg-transparent [&>pre]:m-0"
        // Safe: Shiki generates this HTML internally from the code string - no user HTML passthrough
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

/**
 * Safe accessor for preferences — returns null when no provider is present
 * (e.g. markdown previews rendered in tests or outside workspace context).
 */
function usePreferencesOptional() {
  try {
    return usePreferences()
  } catch {
    return null
  }
}
