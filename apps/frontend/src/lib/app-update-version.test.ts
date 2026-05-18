import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getNotifiedVersion, setNotifiedVersion } from "./app-update-version"

describe("app-update-version", () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it("returns null when no version has been notified", () => {
    expect(getNotifiedVersion()).toBeNull()
  })

  it("round-trips the notified build version", () => {
    setNotifiedVersion("abc1234")
    expect(getNotifiedVersion()).toBe("abc1234")
  })

  it("overwrites with the latest notified version", () => {
    setNotifiedVersion("abc1234")
    setNotifiedVersion("def5678")
    expect(getNotifiedVersion()).toBe("def5678")
  })
})
