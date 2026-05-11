import { describe, test, expect } from "bun:test"
import { fingerprintContent, fingerprintManifest } from "./fingerprint"

describe("fingerprintContent", () => {
  test("produces a deterministic sha256 for the same input", () => {
    const a = fingerprintContent("hello world")
    const b = fingerprintContent("hello world")
    expect(a).toBe(b)
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  test("produces different hashes for different content", () => {
    expect(fingerprintContent("a")).not.toBe(fingerprintContent("b"))
  })

  test("any whitespace difference flips the hash", () => {
    expect(fingerprintContent("a b")).not.toBe(fingerprintContent("a  b"))
  })
})

describe("fingerprintManifest", () => {
  test("ignores ordering-insensitive runs that are actually identical", () => {
    const manifest = [
      { messageId: "msg_a", contentFingerprint: "sha256:a", editedAt: null, deleted: false },
      { messageId: "msg_b", contentFingerprint: "sha256:b", editedAt: null, deleted: false },
    ]
    const again = [...manifest]
    expect(fingerprintManifest(manifest)).toBe(fingerprintManifest(again))
  })

  test("flips when a message's content fingerprint changes", () => {
    const before = fingerprintManifest([
      { messageId: "msg_a", contentFingerprint: "sha256:a1", editedAt: null, deleted: false },
    ])
    const after = fingerprintManifest([
      { messageId: "msg_a", contentFingerprint: "sha256:a2", editedAt: null, deleted: false },
    ])
    expect(before).not.toBe(after)
  })

  test("flips when editedAt changes even if content fingerprint is the same", () => {
    const before = fingerprintManifest([
      { messageId: "msg_a", contentFingerprint: "sha256:a1", editedAt: null, deleted: false },
    ])
    const after = fingerprintManifest([
      { messageId: "msg_a", contentFingerprint: "sha256:a1", editedAt: "2026-04-22T09:10:00Z", deleted: false },
    ])
    expect(before).not.toBe(after)
  })

  test("flips when a message is marked deleted", () => {
    const before = fingerprintManifest([
      { messageId: "msg_a", contentFingerprint: "sha256:a1", editedAt: null, deleted: false },
    ])
    const after = fingerprintManifest([
      { messageId: "msg_a", contentFingerprint: "sha256:a1", editedAt: null, deleted: true },
    ])
    expect(before).not.toBe(after)
  })

  test("distinguishes different orderings — canonical fingerprint is order-sensitive", () => {
    const a = fingerprintManifest([
      { messageId: "msg_a", contentFingerprint: "sha256:a", editedAt: null, deleted: false },
      { messageId: "msg_b", contentFingerprint: "sha256:b", editedAt: null, deleted: false },
    ])
    const b = fingerprintManifest([
      { messageId: "msg_b", contentFingerprint: "sha256:b", editedAt: null, deleted: false },
      { messageId: "msg_a", contentFingerprint: "sha256:a", editedAt: null, deleted: false },
    ])
    expect(a).not.toBe(b)
  })
})
