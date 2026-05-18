import { describe, expect, it } from "vitest"
import { shouldNotifyUpdate } from "./use-app-update"

const RUNNING = "abc1234"

describe("shouldNotifyUpdate", () => {
  it("notifies when the server build is newer and not yet announced", () => {
    expect(shouldNotifyUpdate("def5678", RUNNING, null)).toBe(true)
  })

  it("stays silent when the server build matches what's running", () => {
    expect(shouldNotifyUpdate(RUNNING, RUNNING, null)).toBe(false)
  })

  it("stays silent for a deploy already announced (the remount/refocus re-toast bug)", () => {
    // User saw the toast for def5678, dismissed it, kept working on the old
    // build. A remount + refocus re-runs the check with the same delta.
    expect(shouldNotifyUpdate("def5678", RUNNING, "def5678")).toBe(false)
  })

  it("notifies again only for a genuinely newer build", () => {
    expect(shouldNotifyUpdate("ghi9012", RUNNING, "def5678")).toBe(true)
  })

  it("stays silent on an empty/missing server version", () => {
    expect(shouldNotifyUpdate("", RUNNING, null)).toBe(false)
  })
})
