/** Strip markdown formatting, returning plain text content. */
export function stripMarkdown(md: string): string {
  return (
    md
      // Remove code blocks (fenced) — extract inner content
      .replace(/```[\s\S]*?```/g, (match) => {
        const lines = match.split("\n")
        return lines.slice(1, -1).join("\n")
      })
      // Remove headers
      .replace(/^#{1,6}\s+/gm, "")
      // Remove bold/italic
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
      .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
      // Remove inline code
      .replace(/`([^`]+)`/g, "$1")
      // Remove images (before links — images use ![])
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      // Remove links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove blockquotes
      .replace(/^>\s?/gm, "")
      // Remove horizontal rules
      .replace(/^---+$/gm, "")
      // Clean up extra whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )
}
