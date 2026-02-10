import { describe, expect, it } from "vitest"
import { QUERY_LOAD_STATE, getQueryLoadState, isQueryLoadStateLoading } from "./query-load-state"

describe("getQueryLoadState", () => {
  it("returns error when query status is error", () => {
    expect(getQueryLoadState("error", "fetching")).toBe(QUERY_LOAD_STATE.ERROR)
  })

  it("returns ready when query status is success", () => {
    expect(getQueryLoadState("success", "fetching")).toBe(QUERY_LOAD_STATE.READY)
  })

  it("returns fetching when query is pending and currently fetching", () => {
    expect(getQueryLoadState("pending", "fetching")).toBe(QUERY_LOAD_STATE.FETCHING)
  })

  it("returns pending when query is pending and not fetching", () => {
    expect(getQueryLoadState("pending", "idle")).toBe(QUERY_LOAD_STATE.PENDING)
  })
})

describe("isQueryLoadStateLoading", () => {
  it("returns true only for pending and fetching", () => {
    expect(isQueryLoadStateLoading(QUERY_LOAD_STATE.PENDING)).toBe(true)
    expect(isQueryLoadStateLoading(QUERY_LOAD_STATE.FETCHING)).toBe(true)
    expect(isQueryLoadStateLoading(QUERY_LOAD_STATE.READY)).toBe(false)
    expect(isQueryLoadStateLoading(QUERY_LOAD_STATE.ERROR)).toBe(false)
  })
})
