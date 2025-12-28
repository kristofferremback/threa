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

/**
 * Get plain text content from a node (for atom nodes like mentions)
 */
function getNodeText(node: JSONContent): string {
  if (node.type === "hardBreak") return "\n"
  if (node.type === "mention") {
    const slug = node.attrs?.slug as string
    return slug ? `@${slug}` : ""
  }
  if (node.type === "channelLink") {
    const slug = node.attrs?.slug as string
    return slug ? `#${slug}` : ""
  }
  if (node.type === "slashCommand") {
    const name = node.attrs?.name as string
    return name ? `/${name}` : ""
  }
  if (node.type === "text") return node.text ?? ""
  return ""
}

/**
 * Check if a node is an atom (mention, channel, command)
 */
function isAtomNode(node: JSONContent): boolean {
  return node.type === "mention" || node.type === "channelLink" || node.type === "slashCommand"
}

/**
 * Get marks from a node, with atom nodes inheriting from adjacent text
 */
function getEffectiveMarks(
  nodes: JSONContent[],
  index: number
): Array<{ type: string; attrs?: Record<string, unknown> }> {
  const node = nodes[index]

  // Text nodes have their own marks
  if (node.type === "text") {
    return node.marks ?? []
  }

  // Atom nodes inherit marks from adjacent text nodes
  if (isAtomNode(node)) {
    // Look for marks from next text node (preferred for "@here hello" case)
    for (let i = index + 1; i < nodes.length; i++) {
      if (nodes[i].type === "text" && nodes[i].marks?.length) {
        return nodes[i].marks!
      }
      if (!isAtomNode(nodes[i])) break
    }
    // Fall back to previous text node
    for (let i = index - 1; i >= 0; i--) {
      if (nodes[i].type === "text" && nodes[i].marks?.length) {
        return nodes[i].marks!
      }
      if (!isAtomNode(nodes[i])) break
    }
  }

  return []
}

/**
 * Check if two mark arrays are equivalent
 */
function marksEqual(
  a: Array<{ type: string; attrs?: Record<string, unknown> }>,
  b: Array<{ type: string; attrs?: Record<string, unknown> }>
): boolean {
  if (a.length !== b.length) return false
  const aTypes = a.map((m) => m.type).sort()
  const bTypes = b.map((m) => m.type).sort()
  return aTypes.every((t, i) => t === bTypes[i])
}

/**
 * Wrap text with markdown mark syntax.
 * Preserves leading/trailing whitespace outside the marks so "Hello @user " with bold
 * becomes "**Hello @user** " not "**Hello @user **" (which doesn't render correctly).
 */
function wrapWithMarks(text: string, marks: Array<{ type: string; attrs?: Record<string, unknown> }>): string {
  if (marks.length === 0) return text

  // Extract leading and trailing whitespace
  const leadingMatch = text.match(/^(\s*)/)
  const trailingMatch = text.match(/(\s*)$/)
  const leading = leadingMatch?.[1] ?? ""
  const trailing = trailingMatch?.[1] ?? ""
  const trimmed = text.slice(leading.length, text.length - trailing.length)

  // Don't wrap pure whitespace
  if (!trimmed) return text

  let result = trimmed
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        result = `**${result}**`
        break
      case "italic":
        result = `*${result}*`
        break
      case "strike":
        result = `~~${result}~~`
        break
      case "code":
        result = "`" + result + "`"
        break
      case "link":
        result = `[${result}](${(mark.attrs?.href as string) ?? ""})`
        break
    }
  }
  return leading + result + trailing
}

function serializeInline(nodes: JSONContent[] | undefined): string {
  if (!nodes) return ""

  // Group consecutive nodes with same effective marks
  const groups: Array<{ text: string; marks: Array<{ type: string; attrs?: Record<string, unknown> }> }> = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const text = getNodeText(node)
    if (!text) continue

    const marks = getEffectiveMarks(nodes, i)

    // Check if we can append to the last group
    if (groups.length > 0 && marksEqual(groups[groups.length - 1].marks, marks)) {
      groups[groups.length - 1].text += text
    } else {
      groups.push({ text, marks })
    }
  }

  // Serialize each group with its marks
  return groups.map((group) => wrapWithMarks(group.text, group.marks)).join("")
}

/**
 * Lookup function to determine mention type from slug.
 * "me" is a special type for the current user's own mentions.
 */
export type MentionTypeLookup = (slug: string) => "user" | "persona" | "broadcast" | "me"

/**
 * Parse Markdown string to ProseMirror JSON
 * This is a simple parser for restoring drafts - Tiptap handles display
 */
export function parseMarkdown(markdown: string, getMentionType?: MentionTypeLookup): JSONContent {
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
        content: parseInlineMarkdown(headingMatch[2], getMentionType),
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
            content: parseInlineMarkdown(quoteLines.join("\n"), getMentionType),
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
              content: parseInlineMarkdown(lines[i].replace(/^[-*]\s/, ""), getMentionType),
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
              content: parseInlineMarkdown(lines[i].replace(/^\d+\.\s/, ""), getMentionType),
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
      content: parseInlineMarkdown(line, getMentionType),
    })
    i++
  }

  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }
}

function parseInlineMarkdown(text: string, getMentionType?: MentionTypeLookup): JSONContent[] {
  if (!text) return []

  const result: JSONContent[] = []

  // Default lookup for mention types (without context, can't determine "me")
  const lookupMentionType: MentionTypeLookup =
    getMentionType ??
    ((slug): "user" | "persona" | "broadcast" | "me" => {
      if (slug === "here" || slug === "channel") return "broadcast"
      return "user"
    })

  // Check for slash command at start of text
  const commandMatch = text.match(/^(\s*)(\/)([\w-]+)/)
  let processText = text
  if (commandMatch) {
    // Preserve leading whitespace
    if (commandMatch[1]) {
      result.push({ type: "text", text: commandMatch[1] })
    }
    result.push({
      type: "slashCommand",
      attrs: { name: commandMatch[3] },
    })
    processText = text.slice(commandMatch[0].length)
  }

  // Inline markdown pattern - captures each format type in separate groups
  // Group layout (order matters for matching priority):
  //   1-3:   Link        [text](url)     → groups: full, text, url
  //   4-5:   BoldItalic  ***text***      → groups: full, text (must come before ** and *)
  //   6-7:   Bold        **text**        → groups: full, text
  //   8-9:   Italic      *text*          → groups: full, text (with negative lookahead/behind for **)
  //   10-11: Strike      ~~text~~        → groups: full, text
  //   12-13: Code        `text`          → groups: full, text
  //   14-15: Mention     @slug           → groups: full, slug
  //   16-17: Channel     #slug           → groups: full, slug
  const inlinePattern =
    /(\[([^\]]+)\]\(([^)]+)\))|(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(?<!\*)(\*([^*]+?)\*)(?!\*)|(\~\~(.+?)\~\~)|(`([^`]+)`)|(@([\w-]+))|(#([\w-]+))/g

  let lastIndex = 0
  let match

  while ((match = inlinePattern.exec(processText)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      result.push({ type: "text", text: processText.slice(lastIndex, match.index) })
    }

    if (match[1]) {
      // Link: [text](url)
      const linkText = match[2]
      const linkUrl = match[3]
      // Recursively parse the link text for nested formatting
      const innerContent = parseInlineMarkdown(linkText, getMentionType)
      for (const node of innerContent) {
        // Add link mark to all nodes (text, mentions, channels, etc.)
        result.push({
          ...node,
          marks: [...(node.marks || []), { type: "link", attrs: { href: linkUrl } }],
        })
      }
    } else if (match[4]) {
      // BoldItalic: ***text*** - apply both marks
      const boldItalicText = match[5]
      const innerContent = parseInlineMarkdown(boldItalicText, getMentionType)
      for (const node of innerContent) {
        // Add both bold and italic marks to all nodes
        result.push({
          ...node,
          marks: [...(node.marks || []), { type: "bold" }, { type: "italic" }],
        })
      }
    } else if (match[6]) {
      // Bold: **text**
      const boldText = match[7]
      const innerContent = parseInlineMarkdown(boldText, getMentionType)
      for (const node of innerContent) {
        // Add bold mark to all nodes (text, mentions, channels, etc.)
        result.push({
          ...node,
          marks: [...(node.marks || []), { type: "bold" }],
        })
      }
    } else if (match[8]) {
      // Italic: *text*
      const italicText = match[9]
      const innerContent = parseInlineMarkdown(italicText, getMentionType)
      for (const node of innerContent) {
        // Add italic mark to all nodes (text, mentions, channels, etc.)
        result.push({
          ...node,
          marks: [...(node.marks || []), { type: "italic" }],
        })
      }
    } else if (match[10]) {
      // Strike: ~~text~~
      const strikeText = match[11]
      const innerContent = parseInlineMarkdown(strikeText, getMentionType)
      for (const node of innerContent) {
        // Add strike mark to all nodes (text, mentions, channels, etc.)
        result.push({
          ...node,
          marks: [...(node.marks || []), { type: "strike" }],
        })
      }
    } else if (match[12]) {
      // Code: `text` (no nesting for code)
      result.push({
        type: "text",
        text: match[13],
        marks: [{ type: "code" }],
      })
    } else if (match[14]) {
      // Mention: @slug
      const slug = match[15]
      result.push({
        type: "mention",
        attrs: { id: slug, slug, name: slug, mentionType: lookupMentionType(slug) },
      })
    } else if (match[16]) {
      // Channel: #slug
      const slug = match[17]
      result.push({
        type: "channelLink",
        attrs: { id: slug, slug, name: slug },
      })
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining plain text
  if (lastIndex < processText.length) {
    result.push({ type: "text", text: processText.slice(lastIndex) })
  }

  return result.length ? result : [{ type: "text", text }]
}
