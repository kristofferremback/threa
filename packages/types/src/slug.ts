/**
 * Shared slug validation rules.
 *
 * Slugs are URL-safe identifiers used for users, personas, channels, and workspaces.
 * These rules are the single source of truth for both frontend and backend.
 *
 * Valid slug characteristics:
 * - Lowercase letters (a-z) and numbers (0-9) only
 * - Hyphens (-) and underscores (_) allowed as word separators
 * - Must start with a letter
 * - No leading/trailing separators
 * - No consecutive separators
 * - Max 50 characters
 */

export const SLUG_MAX_LENGTH = 50

/**
 * Pattern for a valid slug.
 * - Starts with a letter
 * - Followed by alphanumeric characters, hyphens, or underscores
 * - Ends with alphanumeric (no trailing separator)
 * - No consecutive separators (enforced separately for clarity)
 */
export const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/

/**
 * Pattern for extracting @mentions from text.
 * Matches @slug where slug follows the valid slug pattern.
 *
 * Key constraints:
 * - @ must NOT be preceded by alphanumeric (avoids email addresses)
 * - Slug must be valid (a-z, 0-9, hyphens, underscores, starts with letter)
 * - Slug must NOT be followed by chars that suggest user intended a longer slug
 */
export const MENTION_PATTERN = /(?<![a-z0-9])@([a-z][a-z0-9_-]*[a-z0-9]|[a-z])(?![a-z0-9.-])/g

/**
 * Check if a string is a valid slug.
 */
export function isValidSlug(slug: string): boolean {
  if (!slug || slug.length > SLUG_MAX_LENGTH) {
    return false
  }

  // Check pattern
  if (!SLUG_PATTERN.test(slug)) {
    return false
  }

  // No consecutive separators
  if (slug.includes("--") || slug.includes("__") || slug.includes("-_") || slug.includes("_-")) {
    return false
  }

  return true
}

/**
 * Characters that are NOT allowed in slugs.
 * Used for generating clear error messages.
 */
export const INVALID_SLUG_CHARS = /[^a-z0-9_-]/g

/**
 * Extract @mentions from message content.
 * Returns unique slugs in order of first occurrence.
 */
export function extractMentionSlugs(content: string): string[] {
  const slugs: string[] = []
  const seen = new Set<string>()

  // Reset regex state
  MENTION_PATTERN.lastIndex = 0

  let match
  while ((match = MENTION_PATTERN.exec(content)) !== null) {
    const slug = match[1]
    if (!seen.has(slug) && isValidSlug(slug)) {
      seen.add(slug)
      slugs.push(slug)
    }
  }

  return slugs
}

/**
 * Check if content contains a specific @mention.
 */
export function hasMention(content: string, slug: string): boolean {
  if (!isValidSlug(slug)) {
    return false
  }

  // Build a specific pattern for this slug
  // Must be preceded by @ and followed by non-slug character or end
  const pattern = new RegExp(`@${escapeRegex(slug)}(?![a-z0-9_-])`)
  return pattern.test(content)
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
