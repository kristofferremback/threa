/**
 * Bidirectional Markdown ↔ ProseMirror JSON conversion.
 *
 * This module provides consistent conversion between markdown text and
 * ProseMirror JSON format, used by both frontend (TipTap editor) and
 * backend (AI agents, external integrators).
 */

import type { JSONContent, JSONContentMark } from "@threa/types"

// ============================================================================
// JSON → Markdown Serialization
// ============================================================================

/**
 * Serialize ProseMirror JSON to Markdown string.
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
 * Get plain text content from a node (for atom nodes like mentions).
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
  if (node.type === "attachmentReference") {
    const id = node.attrs?.id as string
    const filename = node.attrs?.filename as string
    const mimeType = node.attrs?.mimeType as string
    const imageIndex = node.attrs?.imageIndex as number | null
    const status = node.attrs?.status as string

    // Skip uploading/error nodes in serialization
    if (status === "uploading" || status === "error") {
      return ""
    }

    // Format: [Image #1](attachment:id) or [filename](attachment:id)
    const isImage = mimeType?.startsWith("image/")
    const displayText = isImage && imageIndex ? `Image #${imageIndex}` : filename
    return `[${displayText}](attachment:${id})`
  }
  if (node.type === "emoji") {
    const shortcode = node.attrs?.shortcode as string
    return shortcode ? `:${shortcode}:` : ""
  }
  if (node.type === "text") return node.text ?? ""
  return ""
}

/**
 * Check if a node is an atom (mention, channel, command, attachment, emoji).
 */
function isAtomNode(node: JSONContent): boolean {
  return (
    node.type === "mention" ||
    node.type === "channelLink" ||
    node.type === "slashCommand" ||
    node.type === "command" ||
    node.type === "attachmentReference" ||
    node.type === "emoji"
  )
}

/**
 * Get marks from a node, with atom nodes inheriting from adjacent text.
 */
function getEffectiveMarks(nodes: JSONContent[], index: number): JSONContentMark[] {
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
 * Check if two mark arrays are equivalent.
 */
function marksEqual(a: JSONContentMark[], b: JSONContentMark[]): boolean {
  if (a.length !== b.length) return false
  const aTypes = a.map((m) => m.type).sort()
  const bTypes = b.map((m) => m.type).sort()
  return aTypes.every((t, i) => t === bTypes[i])
}

/**
 * Wrap text with markdown mark syntax.
 * Preserves leading/trailing whitespace outside the marks.
 */
function wrapWithMarks(text: string, marks: JSONContentMark[]): string {
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
  const groups: Array<{ text: string; marks: JSONContentMark[] }> = []

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

// ============================================================================
// Markdown → JSON Parsing
// ============================================================================

/**
 * Lookup function to determine mention type from slug.
 * "me" is a special type for the current user's own mentions.
 */
export type MentionTypeLookup = (slug: string) => "user" | "persona" | "broadcast" | "me"

/**
 * Lookup function to get emoji character from shortcode.
 * Returns null if shortcode is not a valid emoji.
 */
export type EmojiLookup = (shortcode: string) => string | null

interface ParseOptions {
  getMentionType?: MentionTypeLookup
  getEmoji?: EmojiLookup
}

/**
 * Parse Markdown string to ProseMirror JSON.
 */
export function parseMarkdown(
  markdown: string,
  getMentionType?: MentionTypeLookup,
  getEmoji?: EmojiLookup
): JSONContent {
  const options: ParseOptions = { getMentionType, getEmoji }
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
        content: parseInlineMarkdown(headingMatch[2], options),
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
            content: parseInlineMarkdown(quoteLines.join("\n"), options),
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
              content: parseInlineMarkdown(lines[i].replace(/^[-*]\s/, ""), options),
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
              content: parseInlineMarkdown(lines[i].replace(/^\d+\.\s/, ""), options),
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
      content: parseInlineMarkdown(line, options),
    })
    i++
  }

  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }
}

function parseInlineMarkdown(text: string, options: ParseOptions = {}): JSONContent[] {
  if (!text) return []

  const result: JSONContent[] = []
  const { getMentionType, getEmoji } = options

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
  const inlinePattern =
    /(\[([^\]]+)\]\(attachment:([^)]+)\))|(\[([^\]]+)\]\(([^)]+)\))|(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(?<!\*)(\*([^*]+?)\*)(?!\*)|(\~\~(.+?)\~\~)|(`([^`]+)`)|(@([\w-]+))|(#([\w-]+))|(:([\w+-]+):)/g

  let lastIndex = 0
  let match

  while ((match = inlinePattern.exec(processText)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      result.push({ type: "text", text: processText.slice(lastIndex, match.index) })
    }

    if (match[1]) {
      // Attachment: [text](attachment:id)
      const displayText = match[2]
      const attachmentId = match[3]
      const imageMatch = displayText.match(/^Image #(\d+)$/)
      const imageIndex = imageMatch ? parseInt(imageMatch[1], 10) : null
      const isImage = imageIndex !== null
      result.push({
        type: "attachmentReference",
        attrs: {
          id: attachmentId,
          filename: isImage ? "" : displayText,
          mimeType: isImage ? "image/unknown" : "application/octet-stream",
          sizeBytes: 0,
          status: "uploaded",
          imageIndex,
          error: null,
        },
      })
    } else if (match[4]) {
      // Link: [text](url)
      const linkText = match[5]
      const linkUrl = match[6]
      const innerContent = parseInlineMarkdown(linkText, options)
      for (const node of innerContent) {
        result.push({
          ...node,
          marks: [...(node.marks || []), { type: "link", attrs: { href: linkUrl } }],
        })
      }
    } else if (match[7]) {
      // BoldItalic: ***text***
      const boldItalicText = match[8]
      const innerContent = parseInlineMarkdown(boldItalicText, options)
      for (const node of innerContent) {
        result.push({
          ...node,
          marks: [...(node.marks || []), { type: "bold" }, { type: "italic" }],
        })
      }
    } else if (match[9]) {
      // Bold: **text**
      const boldText = match[10]
      const innerContent = parseInlineMarkdown(boldText, options)
      for (const node of innerContent) {
        result.push({
          ...node,
          marks: [...(node.marks || []), { type: "bold" }],
        })
      }
    } else if (match[11]) {
      // Italic: *text*
      const italicText = match[12]
      const innerContent = parseInlineMarkdown(italicText, options)
      for (const node of innerContent) {
        result.push({
          ...node,
          marks: [...(node.marks || []), { type: "italic" }],
        })
      }
    } else if (match[13]) {
      // Strike: ~~text~~
      const strikeText = match[14]
      const innerContent = parseInlineMarkdown(strikeText, options)
      for (const node of innerContent) {
        result.push({
          ...node,
          marks: [...(node.marks || []), { type: "strike" }],
        })
      }
    } else if (match[15]) {
      // Code: `text` (no nesting for code)
      result.push({
        type: "text",
        text: match[16],
        marks: [{ type: "code" }],
      })
    } else if (match[17]) {
      // Mention: @slug
      const slug = match[18]
      result.push({
        type: "mention",
        attrs: { id: slug, slug, mentionType: lookupMentionType(slug) },
      })
    } else if (match[19]) {
      // Channel: #slug
      const slug = match[20]
      result.push({
        type: "channelLink",
        attrs: { id: slug, slug },
      })
    } else if (match[21]) {
      // Emoji: :shortcode:
      const shortcode = match[22]
      const emoji = getEmoji?.(shortcode)
      if (emoji) {
        result.push({
          type: "emoji",
          attrs: { shortcode },
        })
      } else {
        // Unknown shortcode - keep as text
        result.push({ type: "text", text: match[0] })
      }
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining plain text
  if (lastIndex < processText.length) {
    result.push({ type: "text", text: processText.slice(lastIndex) })
  }

  return result.length ? result : [{ type: "text", text }]
}
