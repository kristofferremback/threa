import emojiData from "./emoji-data.json"

const SHORTCODE_REGEX = /^:[a-z0-9_+-]+:$/

// Build reverse lookup: emoji → shortcode
const emojiToShortcode = new Map<string, string>()
const shortcodeToEmoji = new Map<string, string>()

for (const [name, emoji] of Object.entries(emojiData.emojis)) {
  shortcodeToEmoji.set(name, emoji)
  // Only set if not already mapped (first shortcode wins for emoji → shortcode)
  if (!emojiToShortcode.has(emoji)) {
    emojiToShortcode.set(emoji, name)
  }
  // Also index emoji without variation selector for lookup flexibility
  const withoutVariation = emoji.replace(/\uFE0F/g, "")
  if (withoutVariation !== emoji && !emojiToShortcode.has(withoutVariation)) {
    emojiToShortcode.set(withoutVariation, name)
  }
}

/**
 * Normalize input to shortcode format.
 * Accepts either raw emoji (👍) or shortcode (:+1:).
 * Returns shortcode with colons (:+1:) or null if invalid.
 */
export function toShortcode(input: string): string | null {
  const trimmed = input.trim()

  // Already a shortcode format?
  if (SHORTCODE_REGEX.test(trimmed)) {
    const name = trimmed.slice(1, -1)
    if (shortcodeToEmoji.has(name)) {
      return trimmed
    }
    return null
  }

  // Try to find emoji in reverse lookup
  const name = emojiToShortcode.get(trimmed)
  if (name) {
    return `:${name}:`
  }

  // Handle emoji with variation selector (try stripping FE0F)
  const withoutVariationSelector = trimmed.replace(/\uFE0F/g, "")
  const nameWithout = emojiToShortcode.get(withoutVariationSelector)
  if (nameWithout) {
    return `:${nameWithout}:`
  }

  return null
}

/**
 * Convert shortcode to emoji.
 * Accepts shortcode with colons (:+1:) or without (+1).
 * Returns emoji string or null if not found.
 */
export function toEmoji(shortcode: string): string | null {
  const trimmed = shortcode.trim()

  // Strip colons if present
  const name = trimmed.startsWith(":") && trimmed.endsWith(":") ? trimmed.slice(1, -1) : trimmed

  return shortcodeToEmoji.get(name) ?? null
}

/**
 * Check if a shortcode exists in the emoji mapping.
 * Accepts shortcode with colons (:+1:) or without (+1).
 */
export function isValidShortcode(shortcode: string): boolean {
  const trimmed = shortcode.trim()
  const name = trimmed.startsWith(":") && trimmed.endsWith(":") ? trimmed.slice(1, -1) : trimmed
  return shortcodeToEmoji.has(name)
}

/**
 * Get all available shortcode names (without colons).
 */
export function getShortcodeNames(): string[] {
  return Array.from(shortcodeToEmoji.keys())
}
