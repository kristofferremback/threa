import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { clearLastWorkspaceId, getLastWorkspaceId, setLastWorkspaceId } from "./last-workspace"

describe("last-workspace", () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it("round-trips the last workspace id", () => {
    setLastWorkspaceId("ws_123")
    expect(getLastWorkspaceId()).toBe("ws_123")
  })

  it("returns null when no workspace has been recorded", () => {
    expect(getLastWorkspaceId()).toBeNull()
  })

  it("clears the recorded workspace (logout / account switch)", () => {
    setLastWorkspaceId("ws_123")
    clearLastWorkspaceId()
    expect(getLastWorkspaceId()).toBeNull()
  })
})
