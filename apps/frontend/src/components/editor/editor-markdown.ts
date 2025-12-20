import type { JSONContent } from "@tiptap/react"

/**
 * Serialize ProseMirror JSON to Markdown string
 */
export function serializeToMarkdown(content: JSONContent): string {
  if (!content.content) return ""
  return content.content.map((node) => serializeNode(node)).join("\n\n")
}

function serializeNode(node: JSONContent, listDepth = 0, listIndex?: number): string {
  if (!node) return ""

  switch (node.type) {
    case "paragraph":
      return serializeInline(node.content)

    case "heading": {
      const level = (node.attrs?.level as number) ?? 1
      return "#".repeat(level) + " " + serializeInline(node.content)
    }

    case "codeBlock": {
      const lang = (node.attrs?.language as string) ?? ""
      const code = node.content?.map((n) => n.text ?? "").join("") ?? ""
      return "```" + lang + "\n" + code + "\n```"
    }

    case "blockquote": {
      const quoted = node.content?.map((n) => serializeNode(n)).join("\n") ?? ""
      return quoted
        .split("\n")
        .map((line) => "> " + line)
        .join("\n")
    }

    case "bulletList":
      return (
        node.content
          ?.map((item) => serializeNode(item, listDepth))
          .filter(Boolean)
          .join("\n") ?? ""
      )

    case "orderedList":
      return (
        node.content
          ?.map((item, i) => serializeNode(item, listDepth, i + 1))
          .filter(Boolean)
          .join("\n") ?? ""
      )

    case "listItem": {
      const indent = "  ".repeat(listDepth)
      const marker = typeof listIndex === "number" ? `${listIndex}. ` : "- "
      const content =
        node.content
          ?.map((n) => {
            if (n.type === "bulletList" || n.type === "orderedList") {
              return serializeNode(n, listDepth + 1)
            }
            return serializeNode(n, listDepth + 1)
          })
          .filter(Boolean)
          .join("\n") ?? ""
      return indent + marker + content
    }

    case "horizontalRule":
      return "---"

    case "hardBreak":
      return "\n"

    default:
      return serializeInline(node.content)
  }
}

function serializeInline(nodes: JSONContent[] | undefined): string {
  if (!nodes) return ""

  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return "\n"
      if (node.type !== "text") return ""

      let text = node.text ?? ""
      const marks = node.marks ?? []

      // Apply marks in reverse order for proper nesting
      for (const mark of marks) {
        switch (mark.type) {
          case "bold":
            text = `**${text}**`
            break
          case "italic":
            text = `*${text}*`
            break
          case "strike":
            text = `~~${text}~~`
            break
          case "code":
            text = "`" + text + "`"
            break
          case "link":
            text = `[${text}](${(mark.attrs?.href as string) ?? ""})`
            break
        }
      }
      return text
    })
    .join("")
}

/**
 * Parse Markdown string to ProseMirror JSON
 * This is a simple parser for restoring drafts - Tiptap handles display
 */
export function parseMarkdown(markdown: string): JSONContent {
  if (!markdown.trim()) {
    return { type: "doc", content: [{ type: "paragraph" }] }
  }

  const lines = markdown.split("\n")
  const content: JSONContent[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      content.push({
        type: "codeBlock",
        attrs: { language: lang || null },
        content: codeLines.length ? [{ type: "text", text: codeLines.join("\n") }] : undefined,
      })
      i++
      continue
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      content.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: parseInlineMarkdown(headingMatch[2]),
      })
      i++
      continue
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2))
        i++
      }
      content.push({
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: parseInlineMarkdown(quoteLines.join("\n")),
          },
        ],
      })
      continue
    }

    // Unordered list
    if (line.match(/^[-*]\s/)) {
      const listItems: JSONContent[] = []
      while (i < lines.length && lines[i].match(/^[-*]\s/)) {
        listItems.push({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: parseInlineMarkdown(lines[i].replace(/^[-*]\s/, "")),
            },
          ],
        })
        i++
      }
      content.push({ type: "bulletList", content: listItems })
      continue
    }

    // Ordered list
    if (line.match(/^\d+\.\s/)) {
      const listItems: JSONContent[] = []
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        listItems.push({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: parseInlineMarkdown(lines[i].replace(/^\d+\.\s/, "")),
            },
          ],
        })
        i++
      }
      content.push({ type: "orderedList", content: listItems })
      continue
    }

    // Horizontal rule
    if (line.match(/^---+$/) || line.match(/^\*\*\*+$/)) {
      content.push({ type: "horizontalRule" })
      i++
      continue
    }

    // Empty line - skip
    if (!line.trim()) {
      i++
      continue
    }

    // Regular paragraph
    content.push({
      type: "paragraph",
      content: parseInlineMarkdown(line),
    })
    i++
  }

  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }
}

function parseInlineMarkdown(text: string): JSONContent[] {
  if (!text) return []

  // For simplicity, just return plain text for now
  // Tiptap will handle the display correctly when the user types
  return [{ type: "text", text }]
}
