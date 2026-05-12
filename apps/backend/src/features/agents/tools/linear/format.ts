export interface BytesTruncateResult {
  text: string
  truncated: boolean
  totalBytes: number
  returnedBytes: number
}

export function truncateBytes(text: string, maxBytes: number): BytesTruncateResult {
  const totalBytes = Buffer.byteLength(text, "utf8")
  if (totalBytes <= maxBytes) return { text, truncated: false, totalBytes, returnedBytes: totalBytes }

  const buf = Buffer.from(text, "utf8")
  let end = maxBytes
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1
  const sliced = buf.subarray(0, end).toString("utf8")
  return { text: sliced, truncated: true, totalBytes, returnedBytes: Buffer.byteLength(sliced, "utf8") }
}

export function toLinearActor(
  user: unknown
): { id: string; name: string; displayName: string; email: string | null } | null {
  if (!user || typeof user !== "object") return null
  const value = user as { id?: unknown; name?: unknown; displayName?: unknown; email?: unknown }
  if (typeof value.id !== "string" || typeof value.name !== "string") return null
  return {
    id: value.id,
    name: value.name,
    displayName: typeof value.displayName === "string" ? value.displayName : value.name,
    email: typeof value.email === "string" ? value.email : null,
  }
}
