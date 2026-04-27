import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api, ApiError } from "./client"

const originalFetch = globalThis.fetch

function mockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("apiFetch error parsing", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("hydrates ApiError from the canonical { error, code } shape emitted by the backend's errorHandler", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(503, { error: "Push notifications are not enabled", code: "PUSH_DISABLED" })
    )

    const err = (await api.get("/anything").catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      status: 503,
      code: "PUSH_DISABLED",
      message: "Push notifications are not enabled",
    })
  })

  it("falls back to a generic message when the body is missing fields", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse(500, {}))
    const err = (await api.get("/anything").catch((e) => e)) as ApiError
    expect(err).toMatchObject({
      status: 500,
      code: "UNKNOWN_ERROR",
      message: "Request failed with status 500",
    })
  })

  it("captures details when the handler ships them alongside error/code", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockResponse(400, {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: { fieldErrors: { endpoint: ["Required"] } },
      })
    )

    const err = (await api.get("/anything").catch((e) => e)) as ApiError
    expect(err).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: { fieldErrors: { endpoint: ["Required"] } },
    })
  })
})
