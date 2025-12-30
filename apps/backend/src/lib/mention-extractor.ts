/**
 * Re-exports mention extraction utilities from @threa/types.
 *
 * The shared module in @threa/types is the single source of truth for
 * slug validation and mention extraction rules.
 */

import { MENTION_PATTERN, isValidSlug } from "@threa/types"

export { extractMentionSlugs, hasMention, isValidSlug, MENTION_PATTERN, SLUG_PATTERN } from "@threa/types"

/**
 * Extended mention info with position (for highlighting, etc).
 */
export interface ExtractedMention {
  slug: string
  position: number
}

/**
 * Extract all @mentions from message content with positions.
 * Returns unique slugs with their first occurrence position.
 */
export function extractMentions(content: string): ExtractedMention[] {
  const mentions: ExtractedMention[] = []
  const seen = new Set<string>()

  // Create a fresh regex instance to avoid state leakage (global regex footgun)
  const pattern = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags)

  let match
  while ((match = pattern.exec(content)) !== null) {
    const slug = match[1]
    if (!seen.has(slug) && isValidSlug(slug)) {
      seen.add(slug)
      mentions.push({
        slug,
        position: match.index,
      })
    }
  }

  return mentions
}
