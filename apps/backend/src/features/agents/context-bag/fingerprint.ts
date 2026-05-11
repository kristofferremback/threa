import { createHash } from "node:crypto"
import type { SummaryInput } from "./types"

/**
 * Content fingerprint of a single message. Hashed over contentMarkdown so any
 * edit flips the fingerprint. Deleted messages get a sentinel fingerprint
 * (the deleted flag is also stored separately) so re-adding the same message
 * text after a delete doesn't collide.
 */
export function fingerprintContent(contentMarkdown: string): string {
  return `sha256:${createHash("sha256").update(contentMarkdown).digest("hex")}`
}

/**
 * Manifest fingerprint: a hash over the canonical `inputs` manifest in order.
 * A change to ANY entry (content, edited_at, deleted) flips this value, which
 * means the summary cache misses and a fresh summary is produced — no silent
 * drift.
 */
export function fingerprintManifest(inputs: SummaryInput[]): string {
  const canonical = inputs.map((input) => ({
    m: input.messageId,
    c: input.contentFingerprint,
    e: input.editedAt,
    d: input.deleted,
  }))
  const json = JSON.stringify(canonical)
  return `sha256:${createHash("sha256").update(json).digest("hex")}`
}
