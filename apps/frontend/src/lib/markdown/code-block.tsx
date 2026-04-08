import { useEffect, useState, useCallback } from "react"
import { codeToHtml } from "shiki"
import { Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"

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

export default function CodeBlock({ language, children }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(children.trim())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API failed, silently ignore
    }
  }, [children])

  useEffect(() => {
    let cancelled = false

    codeToHtml(children.trim(), {
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
  }, [children, language])

  const header = (
    <div className="flex items-center justify-between px-2.5 py-1 bg-muted/50 border-b border-border">
      <span className="text-[11px] font-medium text-muted-foreground font-mono">{formatLanguage(language)}</span>
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded transition-all duration-150",
          "opacity-0 group-hover:opacity-100",
          copied
            ? "bg-green-500/15 text-green-600 dark:text-green-400"
            : "text-muted-foreground hover:bg-primary/15 hover:text-primary"
        )}
        title={copied ? "Copied!" : "Copy code"}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  )

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
