import { describe, expect, spyOn, test } from "bun:test"
import type { NextFunction, Request, Response } from "express"
import { httpActiveConnections, httpRequestDuration, httpRequestsTotal } from "../lib/observability"
import { createMetricsMiddleware } from "./metrics"

interface MockResponse {
  finishHandler?: () => void
}

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    path: "/api/test",
    query: {},
    params: {},
    ...overrides,
  } as Request
}

function createRes(statusCode = 200): Response & MockResponse {
  return {
    statusCode,
    on(event: string, handler: () => void) {
      if (event === "finish") {
        this.finishHandler = handler
      }
      return this
    },
  } as Response & MockResponse
}

function run(middleware: ReturnType<typeof createMetricsMiddleware>, req: Request, res: Response & MockResponse) {
  let nextCalled = false
  const next: NextFunction = () => {
    nextCalled = true
  }

  middleware(req, res, next)
  return { nextCalled }
}

describe("createMetricsMiddleware", () => {
  test("skips metrics for configured ignored paths", () => {
    const activeIncSpy = spyOn(httpActiveConnections, "inc").mockImplementation(() => httpActiveConnections)
    const activeDecSpy = spyOn(httpActiveConnections, "dec").mockImplementation(() => httpActiveConnections)
    const requestsIncSpy = spyOn(httpRequestsTotal, "inc").mockImplementation(() => httpRequestsTotal)
    const durationObserveSpy = spyOn(httpRequestDuration, "observe").mockImplementation(() => httpRequestDuration)

    const middleware = createMetricsMiddleware({ ignoredPaths: ["/ignored"] })
    const res = createRes()
    const want = { nextCalled: true, finishHandler: undefined }
    const got = run(middleware, createReq({ path: "/ignored" }), res)

    expect({ nextCalled: got.nextCalled, finishHandler: res.finishHandler }).toEqual(want)
    expect(activeIncSpy).not.toHaveBeenCalled()
    expect(activeDecSpy).not.toHaveBeenCalled()
    expect(requestsIncSpy).not.toHaveBeenCalled()
    expect(durationObserveSpy).not.toHaveBeenCalled()

    activeIncSpy.mockRestore()
    activeDecSpy.mockRestore()
    requestsIncSpy.mockRestore()
    durationObserveSpy.mockRestore()
  })

  test("records metrics for non-ignored paths", () => {
    const activeIncSpy = spyOn(httpActiveConnections, "inc").mockImplementation(() => httpActiveConnections)
    const activeDecSpy = spyOn(httpActiveConnections, "dec").mockImplementation(() => httpActiveConnections)
    const requestsIncSpy = spyOn(httpRequestsTotal, "inc").mockImplementation(() => httpRequestsTotal)
    const durationObserveSpy = spyOn(httpRequestDuration, "observe").mockImplementation(() => httpRequestDuration)

    const middleware = createMetricsMiddleware({ ignoredPaths: ["/health", "/readyz", "/metrics"] })
    const req = createReq({
      method: "POST",
      path: "/api/workspaces/ws_123/streams",
      route: { path: "/api/workspaces/:workspaceId/streams" } as unknown as Request["route"],
      query: { offset: "0", limit: "10" },
      params: { workspaceId: "ws_123" },
    })
    const res = createRes(404)
    const got = run(middleware, req, res)
    res.finishHandler?.()

    const wantLabels = {
      method: "POST",
      normalized_path: "/api/workspaces/:workspaceId/streams?limit&offset",
      status_code: "404",
      error_type: "not_found",
      workspace_id: "ws_123",
    }

    expect(got).toEqual({ nextCalled: true })
    expect(activeIncSpy).toHaveBeenCalledTimes(1)
    expect(activeDecSpy).toHaveBeenCalledTimes(1)
    expect(requestsIncSpy).toHaveBeenCalledWith(wantLabels)
    expect(durationObserveSpy).toHaveBeenCalledWith(wantLabels, expect.any(Number))

    activeIncSpy.mockRestore()
    activeDecSpy.mockRestore()
    requestsIncSpy.mockRestore()
    durationObserveSpy.mockRestore()
  })
})
