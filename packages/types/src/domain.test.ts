import { describe, test, expect } from "bun:test"
import { getAvatarUrl } from "./domain"

describe("getAvatarUrl", () => {
  test("constructs workspace-scoped URL for valid avatar key", () => {
    expect(getAvatarUrl("avatars/ws_123/mem_456/1700000000000", 256)).toBe(
      "/api/workspaces/ws_123/files/avatars/mem_456/1700000000000.256.webp"
    )
    expect(getAvatarUrl("avatars/ws_123/mem_456/1700000000000", 64)).toBe(
      "/api/workspaces/ws_123/files/avatars/mem_456/1700000000000.64.webp"
    )
  })

  test("returns undefined for null/undefined", () => {
    expect(getAvatarUrl(null, 256)).toBeUndefined()
    expect(getAvatarUrl(undefined, 64)).toBeUndefined()
  })

  test("throws on malformed avatar key (wrong segment count)", () => {
    expect(() => getAvatarUrl("avatars/ws_123", 256)).toThrow("Malformed avatarUrl")
  })

  test("throws on malformed avatar key (wrong prefix)", () => {
    expect(() => getAvatarUrl("files/ws_123/mem_456/12345", 256)).toThrow("Malformed avatarUrl")
  })
})
