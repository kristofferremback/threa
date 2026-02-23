import { describe, expect, test } from "bun:test"
import type { NextFunction, Request, Response } from "express"
import { createOpsAccessMiddleware, isInternalNetworkIp } from "./ops-access"

interface MockResponse {
  statusCode: number
  body: unknown
}

function createReq(remoteAddress: string, headers: Request["headers"] = {}): Request {
  return {
    ip: "should-not-be-used",
    headers,
    socket: { remoteAddress },
  } as unknown as Request
}

function createRes(): Response & MockResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  } as Response & MockResponse
}

describe("isInternalNetworkIp", () => {
  test("accepts private and loopback addresses", () => {
    expect(isInternalNetworkIp("127.0.0.1")).toBe(true)
    expect(isInternalNetworkIp("10.0.0.8")).toBe(true)
    expect(isInternalNetworkIp("192.168.1.12")).toBe(true)
    expect(isInternalNetworkIp("::1")).toBe(true)
    expect(isInternalNetworkIp("::ffff:127.0.0.1")).toBe(true)
  })

  test("rejects public addresses", () => {
    expect(isInternalNetworkIp("8.8.8.8")).toBe(false)
    expect(isInternalNetworkIp("1.1.1.1")).toBe(false)
  })
})

describe("createOpsAccessMiddleware", () => {
  test("blocks non-internal addresses", () => {
    const middleware = createOpsAccessMiddleware()
    const req = createReq("8.8.8.8")
    const res = createRes()
    let nextCalled = false
    const next: NextFunction = () => {
      nextCalled = true
    }

    middleware(req, res, next)

    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  test("allows internal addresses", () => {
    const middleware = createOpsAccessMiddleware()
    const req = createReq("127.0.0.1")
    const res = createRes()
    let nextCalled = false
    const next: NextFunction = () => {
      nextCalled = true
    }

    middleware(req, res, next)

    expect(nextCalled).toBe(true)
    expect(res.statusCode).toBe(200)
  })

  test("uses TCP peer address, not req.ip (which trusts X-Forwarded-For via trust proxy)", () => {
    const middleware = createOpsAccessMiddleware()
    // socket.remoteAddress is the real TCP peer (public IP),
    // even if req.ip is spoofed to loopback via X-Forwarded-For
    const req = createReq("8.8.8.8", { "x-forwarded-for": "127.0.0.1" } as Request["headers"])
    const res = createRes()
    let nextCalled = false
    const next: NextFunction = () => {
      nextCalled = true
    }

    middleware(req, res, next)

    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(403)
  })
})
