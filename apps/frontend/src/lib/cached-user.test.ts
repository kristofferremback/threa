import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { clearCachedUser, getCachedUser, setCachedUser } from "./cached-user"

describe("cached-user", () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it("round-trips the display identity", () => {
    setCachedUser({ id: "user_1", email: "a@b.co", name: "Ada" })
    expect(getCachedUser()).toEqual({ id: "user_1", email: "a@b.co", name: "Ada" })
  })

  it("returns null when nothing is cached", () => {
    expect(getCachedUser()).toBeNull()
  })

  it("clears the cached identity", () => {
    setCachedUser({ id: "user_1", email: "a@b.co", name: "Ada" })
    clearCachedUser()
    expect(getCachedUser()).toBeNull()
  })

  it("rejects a partial / malformed payload instead of returning a half user", () => {
    localStorage.setItem("threa-cached-user", JSON.stringify({ id: "user_1", email: "a@b.co" }))
    expect(getCachedUser()).toBeNull()
  })

  it("returns null on unparseable JSON rather than throwing", () => {
    localStorage.setItem("threa-cached-user", "{not json")
    expect(getCachedUser()).toBeNull()
  })
})
