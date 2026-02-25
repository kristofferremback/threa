const SAFE_REDIRECT_FALLBACK = "/"
const INTERNAL_BASE_URL = "http://localhost"

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value)
}

function sanitizeRedirectTarget(target: string | undefined): string {
  if (!target) return SAFE_REDIRECT_FALLBACK

  const trimmed = target.trim()
  if (!trimmed || hasControlChars(trimmed)) {
    return SAFE_REDIRECT_FALLBACK
  }

  // Relative-path only policy:
  // - must start with /
  // - must not start with // (protocol-relative external redirect)
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return SAFE_REDIRECT_FALLBACK
  }

  try {
    const parsed = new URL(trimmed, INTERNAL_BASE_URL)
    if (parsed.origin !== INTERNAL_BASE_URL) {
      return SAFE_REDIRECT_FALLBACK
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || SAFE_REDIRECT_FALLBACK
  } catch {
    return SAFE_REDIRECT_FALLBACK
  }
}

export function decodeAndSanitizeRedirectState(state: string | undefined): string {
  if (!state) return SAFE_REDIRECT_FALLBACK

  try {
    const decoded = Buffer.from(state, "base64").toString("utf-8")
    return sanitizeRedirectTarget(decoded)
  } catch {
    return SAFE_REDIRECT_FALLBACK
  }
}
