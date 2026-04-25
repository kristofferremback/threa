/**
 * Escape a string for safe inclusion as an XML attribute value. Used by the
 * AI message-formatter and the agent context-builders that emit XML-tagged
 * source blocks (`<quoted-source …>`, `<shared-message-source …>`) into the
 * model's prompt context.
 *
 * Escapes the four characters that would otherwise terminate or open an
 * attribute / element: `&`, `<`, `>`, `"`. Order matters — `&` is escaped
 * first so the entity sequences emitted for the others are not double-escaped.
 */
export function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
