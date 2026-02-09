import { describe, expect, test } from "bun:test"
import type { Response } from "express"
import { createDebugHandlers } from "./debug-handlers"

interface JsonResponseMock extends Partial<Response> {
  payload?: unknown
}

function createJsonResponseMock(): Response & JsonResponseMock {
  return {
    json(payload: unknown) {
      this.payload = payload
      return this as Response
    },
  } as Response & JsonResponseMock
}

describe("createDebugHandlers", () => {
  test("should return readiness payload with pool stats", () => {
    const mockPools = [
      {
        poolName: "main",
        totalCount: 6,
        idleCount: 4,
        waitingCount: 0,
        utilizationPercent: 33,
        timestamp: "2026-02-09T10:00:00.000Z",
      },
    ]

    const handlers = createDebugHandlers({
      pool: {} as any,
      poolMonitor: {
        getAllPoolStats: () => mockPools,
      } as any,
    })

    const res = createJsonResponseMock()
    handlers.readiness({} as any, res)

    expect(res.payload).toMatchObject({
      status: "ok",
      pools: mockPools,
      timestamp: expect.any(String),
    })
  })
})
