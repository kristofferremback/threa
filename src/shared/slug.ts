/**
 * Shared slug generation utilities for channel names.
 * Used by both frontend (validation) and backend (creation).
 */

// Character normalization map for common non-ASCII letters
const CHAR_MAP: Record<string, string> = {
  // German
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
  Ä: "ae",
  Ö: "oe",
  Ü: "ue",

  // Nordic
  å: "a",
  Å: "a",
  æ: "ae",
  Æ: "ae",
  ø: "o",
  Ø: "o",

  // French
  à: "a",
  â: "a",
  ç: "c",
  é: "e",
  è: "e",
  ê: "e",
  ë: "e",
  î: "i",
  ï: "i",
  ô: "o",
  ù: "u",
  û: "u",
  ÿ: "y",
  À: "a",
  Â: "a",
  Ç: "c",
  É: "e",
  È: "e",
  Ê: "e",
  Ë: "e",
  Î: "i",
  Ï: "i",
  Ô: "o",
  Ù: "u",
  Û: "u",
  Ÿ: "y",

  // Spanish/Portuguese
  ñ: "n",
  Ñ: "n",
  ã: "a",
  õ: "o",
  Ã: "a",
  Õ: "o",

  // Polish
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ś: "s",
  ź: "z",
  ż: "z",
  Ą: "a",
  Ć: "c",
  Ę: "e",
  Ł: "l",
  Ń: "n",
  Ś: "s",
  Ź: "z",
  Ż: "z",

  // Czech/Slovak
  č: "c",
  ď: "d",
  ě: "e",
  ň: "n",
  ř: "r",
  š: "s",
  ť: "t",
  ů: "u",
  ý: "y",
  ž: "z",
  Č: "c",
  Ď: "d",
  Ě: "e",
  Ň: "n",
  Ř: "r",
  Š: "s",
  Ť: "t",
  Ů: "u",
  Ý: "y",
  Ž: "z",

  // Turkish
  ğ: "g",
  ı: "i",
  ş: "s",
  Ğ: "g",
  İ: "i",
  Ş: "s",

  // Other common
  ð: "d",
  þ: "th",
  Ð: "d",
  Þ: "th",
}

/**
 * Normalize a string by replacing special characters with ASCII equivalents.
 */
function normalizeCharacters(str: string): string {
  let result = ""
  for (const char of str) {
    result += CHAR_MAP[char] || char
  }
  return result
}

/**
 * Generate a URL-safe slug from a channel name.
 *
 * Rules:
 * - Normalizes non-ASCII letters (ä → ae, ß → ss, etc.)
 * - Removes emojis and other non-alphanumeric characters
 * - Converts to lowercase
 * - Replaces spaces/separators with hyphens
 * - Collapses multiple hyphens
 * - Trims leading/trailing hyphens
 *
 * @param name - The channel name to slugify
 * @returns The generated slug (may be empty if name has no valid characters)
 */
export function generateSlug(name: string): string {
  return (
    normalizeCharacters(name)
      // Convert to lowercase
      .toLowerCase()
      // Replace any non-alphanumeric character with hyphen
      .replace(/[^a-z0-9]+/g, "-")
      // Collapse multiple hyphens
      .replace(/-+/g, "-")
      // Trim leading/trailing hyphens
      .replace(/^-|-$/g, "")
  )
}

/**
 * Minimum required length for a valid slug.
 */
export const MIN_SLUG_LENGTH = 3

/**
 * Maximum allowed length for a slug.
 */
export const MAX_SLUG_LENGTH = 80

/**
 * Validate a slug and return validation result.
 */
export function validateSlug(slug: string): {
  valid: boolean
  error?: string
} {
  if (!slug) {
    return {
      valid: false,
      error: "Channel name must contain at least some letters or numbers",
    }
  }

  if (slug.length < MIN_SLUG_LENGTH) {
    return {
      valid: false,
      error: `Channel name is too short (minimum ${MIN_SLUG_LENGTH} characters after conversion)`,
    }
  }

  if (slug.length > MAX_SLUG_LENGTH) {
    return {
      valid: false,
      error: `Channel name is too long (maximum ${MAX_SLUG_LENGTH} characters)`,
    }
  }

  // Check for valid characters (should already be clean from generateSlug, but double-check)
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return {
      valid: false,
      error: "Channel name contains invalid characters",
    }
  }

  return { valid: true }
}

/**
 * Generate and validate a slug in one step.
 * Returns the slug and any validation errors.
 */
export function createValidSlug(name: string): {
  slug: string
  valid: boolean
  error?: string
} {
  const slug = generateSlug(name)
  const validation = validateSlug(slug)
  return {
    slug,
    ...validation,
  }
}
