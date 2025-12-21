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
          ?.map((n) => serializeNode(n, listDepth + 1))
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

  const result: JSONContent[] = []

  // Inline markdown pattern - captures each format type in separate groups
  // Group layout (order matters for matching priority):
  //   1-3:  Link     [text](url)     → groups: full, text, url
  //   4-5:  Bold     **text**        → groups: full, text
  //   6-7:  Italic   *text*          → groups: full, text (with negative lookahead/behind for **)
  //   8-9:  Strike   ~~text~~        → groups: full, text
  //   10-11: Code    `text`          → groups: full, text
  const inlinePattern =
    /(\[([^\]]+)\]\(([^)]+)\))|(\*\*(.+?)\*\*)|(?<!\*)(\*([^*]+?)\*)(?!\*)|(\~\~(.+?)\~\~)|(`([^`]+)`)/g

  let lastIndex = 0
  let match

  while ((match = inlinePattern.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      result.push({ type: "text", text: text.slice(lastIndex, match.index) })
    }

    if (match[1]) {
      // Link: [text](url)
      const linkText = match[2]
      const linkUrl = match[3]
      // Recursively parse the link text for nested formatting
      const innerContent = parseInlineMarkdown(linkText)
      for (const node of innerContent) {
        if (node.type === "text") {
          result.push({
            type: "text",
            text: node.text,
            marks: [...(node.marks || []), { type: "link", attrs: { href: linkUrl } }],
          })
        } else {
          result.push(node)
        }
      }
    } else if (match[4]) {
      // Bold: **text**
      const boldText = match[5]
      const innerContent = parseInlineMarkdown(boldText)
      for (const node of innerContent) {
        if (node.type === "text") {
          result.push({
            type: "text",
            text: node.text,
            marks: [...(node.marks || []), { type: "bold" }],
          })
        } else {
          result.push(node)
        }
      }
    } else if (match[6]) {
      // Italic: *text*
      const italicText = match[7]
      const innerContent = parseInlineMarkdown(italicText)
      for (const node of innerContent) {
        if (node.type === "text") {
          result.push({
            type: "text",
            text: node.text,
            marks: [...(node.marks || []), { type: "italic" }],
          })
        } else {
          result.push(node)
        }
      }
    } else if (match[8]) {
      // Strike: ~~text~~
      const strikeText = match[9]
      const innerContent = parseInlineMarkdown(strikeText)
      for (const node of innerContent) {
        if (node.type === "text") {
          result.push({
            type: "text",
            text: node.text,
            marks: [...(node.marks || []), { type: "strike" }],
          })
        } else {
          result.push(node)
        }
      }
    } else if (match[10]) {
      // Code: `text` (no nesting for code)
      result.push({
        type: "text",
        text: match[11],
        marks: [{ type: "code" }],
      })
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    result.push({ type: "text", text: text.slice(lastIndex) })
  }

  return result.length ? result : [{ type: "text", text }]
}
