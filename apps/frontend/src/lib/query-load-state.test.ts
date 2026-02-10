import { describe, expect, it } from "vitest"
import { ApiError } from "@/api/client"
import {
  QUERY_LOAD_STATE,
  getQueryLoadState,
  isQueryLoadStateLoading,
  isTerminalBootstrapError,
} from "./query-load-state"

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

describe("isTerminalBootstrapError", () => {
  it("returns true for 403 and 404 API errors", () => {
    expect(isTerminalBootstrapError(new ApiError(403, "FORBIDDEN", "Forbidden"))).toBe(true)
    expect(isTerminalBootstrapError(new ApiError(404, "NOT_FOUND", "Not found"))).toBe(true)
  })

  it("returns false for non-terminal or non-api errors", () => {
    expect(isTerminalBootstrapError(new ApiError(500, "INTERNAL", "Internal error"))).toBe(false)
    expect(isTerminalBootstrapError(new Error("boom"))).toBe(false)
  })
})
