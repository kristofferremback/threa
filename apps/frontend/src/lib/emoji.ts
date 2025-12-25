import emojiData from "./emoji-data.json"

// Build shortcode → emoji lookup map
const shortcodeToEmoji = new Map<string, string>()

for (const { emoji, shortcodes } of emojiData.emojis) {
  for (const shortcode of shortcodes) {
    shortcodeToEmoji.set(shortcode, emoji)
  }
}

/**
 * Convert shortcode to emoji.
 * Accepts shortcode with colons (:thread:) or without (thread).
 * Returns emoji string or null if not found.
 */
export function toEmoji(shortcode: string): string | null {
  const trimmed = shortcode.trim()

  // Strip colons if present
  const name = trimmed.startsWith(":") && trimmed.endsWith(":") ? trimmed.slice(1, -1) : trimmed

  return shortcodeToEmoji.get(name) ?? null
}
