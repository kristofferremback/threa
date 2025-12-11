import emojiData from "./emoji-data.json"

const SHORTCODE_REGEX = /^:[a-z0-9_+-]+:$/

// Build lookup maps from array format
// Data format: { emojis: [{ emoji: "👍", shortcodes: ["+1", "thumbsup"] }, ...] }
const emojiToShortcode = new Map<string, string>()
const shortcodeToEmoji = new Map<string, string>()

for (const { emoji, shortcodes } of emojiData.emojis) {
  // First shortcode is the canonical/default one
  const primaryShortcode = shortcodes[0]

  // Map all shortcodes to this emoji
  for (const shortcode of shortcodes) {
    shortcodeToEmoji.set(shortcode, emoji)
  }

  // Map emoji → primary shortcode (first one wins)
  if (!emojiToShortcode.has(emoji)) {
    emojiToShortcode.set(emoji, primaryShortcode)
  }

  // Also index emoji without variation selector for lookup flexibility
  const withoutVariation = emoji.replace(/\uFE0F/g, "")
  if (withoutVariation !== emoji && !emojiToShortcode.has(withoutVariation)) {
    emojiToShortcode.set(withoutVariation, primaryShortcode)
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

// Regex to match emoji in text (covers most emoji including compound sequences)
const EMOJI_REGEX =
  /(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier_Base})(\p{Emoji_Modifier}|\uFE0F|\u200D(\p{Extended_Pictographic}|\p{Emoji_Presentation}))*/gu

/**
 * Normalize all emoji in a message to shortcode format.
 * Replaces raw emoji (👍) with shortcodes (:+1:).
 * Unknown emoji are left unchanged.
 */
export function normalizeMessage(message: string): string {
  return message.replace(EMOJI_REGEX, (match) => {
    const shortcode = emojiToShortcode.get(match)
    if (shortcode) {
      return `:${shortcode}:`
    }
    // Try without variation selector
    const withoutVariation = match.replace(/\uFE0F/g, "")
    const shortcodeWithout = emojiToShortcode.get(withoutVariation)
    if (shortcodeWithout) {
      return `:${shortcodeWithout}:`
    }
    // Unknown emoji, leave as-is
    return match
  })
}
