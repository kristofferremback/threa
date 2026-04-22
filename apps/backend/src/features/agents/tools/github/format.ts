export interface LineSliceResult {
  text: string
  startLine: number
  endLine: number
  totalLines: number
  totalBytes: number
  truncated: boolean
  truncationReason?: "line_cap" | "byte_cap"
  nextStartLine?: number
}

export interface LineSliceOptions {
  fromLine?: number
  toLine?: number
  maxLines: number
  maxBytes: number
}

/**
 * Slice text by 1-indexed inclusive line range with both line-count and byte caps.
 * Returns enough metadata for a model to request the next chunk if truncated.
 */
export function sliceLines(text: string, opts: LineSliceOptions): LineSliceResult {
  const normalized = text.replace(/\r\n/g, "\n")
  const allLines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n")
  const totalLines = allLines.length
  const totalBytes = Buffer.byteLength(normalized, "utf8")

  const fromLine = Math.max(1, opts.fromLine ?? 1)
  const naturalEnd = Math.min(totalLines, opts.toLine ?? totalLines)
  const capEnd = Math.min(totalLines, fromLine + opts.maxLines - 1)
  let endLine = Math.min(naturalEnd, capEnd)
  if (endLine < fromLine) endLine = fromLine

  let slice = allLines.slice(fromLine - 1, endLine).join("\n")
  let truncationReason: "line_cap" | "byte_cap" | undefined
  let truncated = false

  if (endLine < naturalEnd) {
    truncated = true
    truncationReason = "line_cap"
  }

  if (Buffer.byteLength(slice, "utf8") > opts.maxBytes) {
    // Shrink to byte cap while preserving whole lines.
    const lines = slice.split("\n")
    const kept: string[] = []
    let running = 0
    let keptLineCount = 0
    for (const line of lines) {
      const next = running + Buffer.byteLength(line, "utf8") + (kept.length > 0 ? 1 : 0)
      if (next > opts.maxBytes) break
      kept.push(line)
      keptLineCount += 1
      running = next
    }
    slice = kept.join("\n")
    endLine = fromLine + keptLineCount - 1
    truncated = true
    truncationReason = "byte_cap"
  }

  const result: LineSliceResult = {
    text: slice,
    startLine: fromLine,
    endLine,
    totalLines,
    totalBytes,
    truncated,
  }
  if (truncationReason) result.truncationReason = truncationReason
  if (truncated && endLine < totalLines) result.nextStartLine = endLine + 1
  return result
}

export interface BytesTruncateResult {
  text: string
  truncated: boolean
  totalBytes: number
  returnedBytes: number
}

export function truncateBytes(text: string, maxBytes: number): BytesTruncateResult {
  const totalBytes = Buffer.byteLength(text, "utf8")
  if (totalBytes <= maxBytes) {
    return { text, truncated: false, totalBytes, returnedBytes: totalBytes }
  }
  const buf = Buffer.from(text, "utf8")
  // Walk back to a valid UTF-8 boundary (bytes in range 0x80..0xBF are continuations).
  let end = maxBytes
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1
  const sliced = buf.subarray(0, end).toString("utf8")
  return { text: sliced, truncated: true, totalBytes, returnedBytes: Buffer.byteLength(sliced, "utf8") }
}

/**
 * Strip noisy/unused fields from GitHub user objects so the model sees only useful identity data.
 */
export function toActor(user: unknown): { login: string; htmlUrl: string | null } | null {
  if (!user || typeof user !== "object") return null
  const login = (user as { login?: unknown }).login
  if (typeof login !== "string") return null
  const htmlUrl = (user as { html_url?: unknown }).html_url
  return { login, htmlUrl: typeof htmlUrl === "string" ? htmlUrl : null }
}
