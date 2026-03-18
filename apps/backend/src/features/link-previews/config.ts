/** Maximum number of link previews to extract per message */
export const MAX_PREVIEWS_PER_MESSAGE = 5

/** Timeout for fetching a single URL's metadata (ms) */
export const FETCH_TIMEOUT_MS = 10_000

/** User-Agent string for metadata fetch requests */
export const FETCH_USER_AGENT = "Threa/1.0 (Link Preview)"

/** Maximum HTML bytes to read before stopping (some sites like YouTube put meta tags 600KB+ in) */
export const MAX_HTML_BYTES = 512 * 1024

/** Maximum description length to store */
export const MAX_DESCRIPTION_LENGTH = 500

/** Maximum title length to store */
export const MAX_TITLE_LENGTH = 300

/** oEmbed providers: URL pattern → endpoint. Tried before HTML scraping for faster, more reliable results. */
export const OEMBED_PROVIDERS: ReadonlyArray<{ pattern: RegExp; endpoint: string }> = [
  { pattern: /^https?:\/\/(?:www\.)?youtube\.com\/watch/, endpoint: "https://www.youtube.com/oembed" },
  { pattern: /^https?:\/\/youtu\.be\//, endpoint: "https://www.youtube.com/oembed" },
  { pattern: /^https?:\/\/(?:www\.)?vimeo\.com\/\d+/, endpoint: "https://vimeo.com/api/oembed.json" },
]
