import { describe, expect, it } from "bun:test"
import { decodeCursor, encodeCursor } from "./cursor"

describe("asset explorer cursor", () => {
  it("round-trips a time cursor", () => {
    const encoded = encodeCursor({
      kind: "time",
      createdAt: "2025-01-01T00:00:00.000Z",
      id: "attach_abc",
    })
    expect(decodeCursor(encoded)).toEqual({
      kind: "time",
      createdAt: "2025-01-01T00:00:00.000Z",
      id: "attach_abc",
    })
  })

  it("round-trips an offset cursor", () => {
    expect(decodeCursor(encodeCursor({ kind: "offset", offset: 30 }))).toEqual({ kind: "offset", offset: 30 })
  })

  it("returns null for malformed input", () => {
    expect(decodeCursor("not-base64-json!")).toBeNull()
    expect(decodeCursor(Buffer.from("{}", "utf8").toString("base64url"))).toBeNull()
    expect(
      decodeCursor(Buffer.from(JSON.stringify({ kind: "offset", offset: -1 }), "utf8").toString("base64url"))
    ).toBeNull()
  })
})
