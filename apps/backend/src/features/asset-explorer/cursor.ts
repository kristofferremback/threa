/**
 * Opaque cursor encoding for the asset explorer.
 *
 * Two cursor variants are defined so browse and search modes can paginate
 * with the right strategy without changing the wire shape:
 *
 *   - `time`: keyset on `(created_at DESC, id DESC)` for browse mode.
 *   - `offset`: numeric offset for query mode where rank-ordered keysets
 *     would be fragile (rank ties + float precision).
 *
 * Cursors are JSON, base64url-encoded so they're URL-safe even though the
 * endpoint is currently POST. Callers treat them as opaque strings.
 */

export type AssetCursor = { kind: "time"; createdAt: string; id: string } | { kind: "offset"; offset: number }

export function encodeCursor(cursor: AssetCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

export function decodeCursor(raw: string): AssetCursor | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8")
    const parsed = JSON.parse(json)
    if (parsed?.kind === "time" && typeof parsed.createdAt === "string" && typeof parsed.id === "string") {
      return { kind: "time", createdAt: parsed.createdAt, id: parsed.id }
    }
    if (parsed?.kind === "offset" && Number.isInteger(parsed.offset) && parsed.offset >= 0) {
      return { kind: "offset", offset: parsed.offset }
    }
    return null
  } catch {
    return null
  }
}
