import { useEffect, useState } from "react"
import { codeToHtml } from "shiki"

interface CodeBlockProps {
  language: string
  children: string
}

export default function CodeBlock({ language, children }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    codeToHtml(children.trim(), {
      lang: language,
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
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

  if (!html) {
    return (
      <pre className="bg-muted rounded-md p-4 overflow-x-auto my-2">
        <code className="text-sm font-mono">{children}</code>
      </pre>
    )
  }

  return (
    <div
      className="my-2 rounded-md overflow-hidden [&>pre]:p-4 [&>pre]:text-sm [&>pre]:overflow-x-auto"
      // Safe: Shiki generates this HTML internally from the code string - no user HTML passthrough
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
