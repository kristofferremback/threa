import { describe, test, expect } from "bun:test"

// Re-implement for testing since it's not exported
function normalizeRoomPattern(room: string): string {
  return room
    .replace(/^ws:[\w]+/, "ws:{workspaceId}")
    .replace(/stream:[\w]+/, "stream:{streamId}")
    .replace(/thread:[\w]+/, "thread:{threadId}")
}

describe("normalizeRoomPattern", () => {
  test("should normalize workspace room", () => {
    expect(normalizeRoomPattern("ws:ws_01ABC123")).toBe("ws:{workspaceId}")
  })

  test("should normalize workspace:stream room", () => {
    expect(normalizeRoomPattern("ws:ws_01ABC123:stream:stream_01XYZ789")).toBe("ws:{workspaceId}:stream:{streamId}")
  })

  test("should normalize workspace:stream:thread room", () => {
    expect(normalizeRoomPattern("ws:ws_01ABC123:stream:stream_01XYZ789:thread:thread_01DEF456")).toBe(
      "ws:{workspaceId}:stream:{streamId}:thread:{threadId}"
    )
  })

  test("should handle IDs with underscores and numbers", () => {
    expect(normalizeRoomPattern("ws:ws_01KFH80A5GVAVQ4WMQNEC42HGX")).toBe("ws:{workspaceId}")
  })

  test("should not modify unrecognized patterns", () => {
    expect(normalizeRoomPattern("unknown:foo")).toBe("unknown:foo")
  })
})
