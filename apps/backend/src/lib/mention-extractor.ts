/**
 * Extracts @mentions from message content.
 *
 * The frontend serializes mentions as @slug (markdown format).
 * This module extracts those slugs for lookup against users/personas.
 */

// Matches @slug patterns where slug is word chars + hyphens
// Same pattern as frontend: [\w-]+
const MENTION_PATTERN = /@([\w-]+)/g

export interface ExtractedMention {
  slug: string
  position: number
}

/**
 * Extract all @mentions from message content.
 * Returns unique slugs with their positions.
 */
export function extractMentions(content: string): ExtractedMention[] {
  const mentions: ExtractedMention[] = []
  const seen = new Set<string>()

  let match
  while ((match = MENTION_PATTERN.exec(content)) !== null) {
    const slug = match[1]
    // Dedupe by slug, keep first occurrence
    if (!seen.has(slug)) {
      seen.add(slug)
      mentions.push({
        slug,
        position: match.index,
      })
    }
  }

  return mentions
}

/**
 * Extract just the unique slugs from message content.
 */
export function extractMentionSlugs(content: string): string[] {
  return extractMentions(content).map((m) => m.slug)
}

/**
 * Check if a message contains a specific @mention.
 */
export function hasMention(content: string, slug: string): boolean {
  const pattern = new RegExp(`@${escapeRegex(slug)}(?![\\w-])`)
  return pattern.test(content)
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
