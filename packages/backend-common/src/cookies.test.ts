import { beforeAll, describe, expect, test } from "bun:test"
import type { Response } from "express"
import type { SessionCookieOptions } from "./cookies"

type CookieCall =
  | { type: "clear"; name: string; options: SessionCookieOptions }
  | { type: "set"; name: string; value: string; options: SessionCookieOptions }

function makeResponseRecorder(): { res: Response; calls: CookieCall[] } {
  const calls: CookieCall[] = []
  const res = {
    clearCookie(name: string, options: SessionCookieOptions) {
      calls.push({ type: "clear", name, options })
      return this
    },
    cookie(name: string, value: string, options: SessionCookieOptions) {
      calls.push({ type: "set", name, value, options })
      return this
    },
  } as unknown as Response

  return { res, calls }
}

describe("session cookies", () => {
  let SESSION_COOKIE_NAME: string
  let setSessionCookie: typeof import("./cookies").setSessionCookie
  let clearSessionCookie: typeof import("./cookies").clearSessionCookie

  beforeAll(async () => {
    process.env.SESSION_COOKIE_NAME = "wos_session_test"
    const cookies = await import("./cookies")
    SESSION_COOKIE_NAME = cookies.SESSION_COOKIE_NAME
    setSessionCookie = cookies.setSessionCookie
    clearSessionCookie = cookies.clearSessionCookie
  })

  test("setting a domain-scoped session first clears a host-only cookie with the same name", () => {
    const { res, calls } = makeResponseRecorder()
    const options = {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      maxAge: 123,
      domain: ".threa.io",
    }

    setSessionCookie(res, "sealed-session", options)

    expect(calls).toEqual([
      {
        type: "clear",
        name: SESSION_COOKIE_NAME,
        options: { path: "/", httpOnly: true, secure: true, sameSite: "lax" },
      },
      { type: "set", name: SESSION_COOKIE_NAME, value: "sealed-session", options },
    ])
  })

  test("clearing a domain-scoped session also clears the host-only variant", () => {
    const { res, calls } = makeResponseRecorder()
    const options = {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      maxAge: 123,
      domain: ".threa.io",
    }

    clearSessionCookie(res, options)

    expect(calls).toEqual([
      {
        type: "clear",
        name: SESSION_COOKIE_NAME,
        options: { path: "/", httpOnly: true, secure: true, sameSite: "lax", domain: ".threa.io" },
      },
      {
        type: "clear",
        name: SESSION_COOKIE_NAME,
        options: { path: "/", httpOnly: true, secure: true, sameSite: "lax" },
      },
    ])
  })
})
