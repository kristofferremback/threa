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

describe("alt session cookies", () => {
  let SESSION_COOKIE_NAME: string
  let MAX_ACCOUNTS: number
  let MAX_ALT_SLOTS: number
  let assertSlot: typeof import("./cookies").assertSlot
  let altSessionCookieName: typeof import("./cookies").altSessionCookieName
  let setAltSessionCookie: typeof import("./cookies").setAltSessionCookie
  let clearAltSessionCookie: typeof import("./cookies").clearAltSessionCookie
  let readAltSessionCookies: typeof import("./cookies").readAltSessionCookies

  beforeAll(async () => {
    process.env.SESSION_COOKIE_NAME = "wos_session_test"
    const cookies = await import("./cookies")
    SESSION_COOKIE_NAME = cookies.SESSION_COOKIE_NAME
    MAX_ACCOUNTS = cookies.MAX_ACCOUNTS
    MAX_ALT_SLOTS = cookies.MAX_ALT_SLOTS
    assertSlot = cookies.assertSlot
    altSessionCookieName = cookies.altSessionCookieName
    setAltSessionCookie = cookies.setAltSessionCookie
    clearAltSessionCookie = cookies.clearAltSessionCookie
    readAltSessionCookies = cookies.readAltSessionCookies
  })

  // The Cookie-header budget guard is enforced at module load (cookies.ts
  // throws if MAX_ACCOUNTS exceeds the documented size), so a successful
  // import already proves the cap fits. This just pins the derivation.
  test("MAX_ALT_SLOTS is always derived as MAX_ACCOUNTS - 1", () => {
    expect(Number.isInteger(MAX_ACCOUNTS)).toBe(true)
    expect(MAX_ACCOUNTS).toBeGreaterThan(0)
    expect(MAX_ALT_SLOTS).toBe(MAX_ACCOUNTS - 1)
  })

  test("assertSlot accepts in-range slots and rejects out-of-range", () => {
    for (let slot = 0; slot < MAX_ALT_SLOTS; slot++) {
      expect(() => assertSlot(slot)).not.toThrow()
    }
    expect(() => assertSlot(-1)).toThrow(RangeError)
    expect(() => assertSlot(MAX_ALT_SLOTS)).toThrow(RangeError)
    expect(() => assertSlot(1.5)).toThrow(RangeError)
    expect(() => assertSlot(Number.NaN)).toThrow(RangeError)
  })

  test("altSessionCookieName derives from the env-scoped base", () => {
    expect(SESSION_COOKIE_NAME).toBe("wos_session_test")
    expect(altSessionCookieName(0)).toBe("wos_session_test_alt_0")
    expect(altSessionCookieName(MAX_ALT_SLOTS - 1)).toBe(`${SESSION_COOKIE_NAME}_alt_${MAX_ALT_SLOTS - 1}`)
    expect(() => altSessionCookieName(MAX_ALT_SLOTS)).toThrow(RangeError)
  })

  test("setAltSessionCookie mirrors the active-cookie host-only dual-clear under the alt name", () => {
    const { res, calls } = makeResponseRecorder()
    const options = {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      maxAge: 123,
      domain: ".threa.io",
    }

    setAltSessionCookie(res, 0, "sealed-alt", options)

    expect(calls).toEqual([
      {
        type: "clear",
        name: "wos_session_test_alt_0",
        options: { path: "/", httpOnly: true, secure: true, sameSite: "lax" },
      },
      { type: "set", name: "wos_session_test_alt_0", value: "sealed-alt", options },
    ])
  })

  test("clearAltSessionCookie clears the alt name and its host-only variant", () => {
    const { res, calls } = makeResponseRecorder()
    const options = {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      maxAge: 123,
      domain: ".threa.io",
    }

    clearAltSessionCookie(res, 1, options)

    expect(calls).toEqual([
      {
        type: "clear",
        name: "wos_session_test_alt_1",
        options: { path: "/", httpOnly: true, secure: true, sameSite: "lax", domain: ".threa.io" },
      },
      {
        type: "clear",
        name: "wos_session_test_alt_1",
        options: { path: "/", httpOnly: true, secure: true, sameSite: "lax" },
      },
    ])
  })

  test("readAltSessionCookies returns only this env's occupied slots, sorted, ignoring active and foreign-env cookies", () => {
    const jar: Record<string, string> = {
      [SESSION_COOKIE_NAME]: "active-sealed",
      [`${SESSION_COOKIE_NAME}_alt_1`]: "slot1",
      [`${SESSION_COOKIE_NAME}_alt_0`]: "slot0",
      [`${SESSION_COOKIE_NAME}_alt_${MAX_ALT_SLOTS}`]: "out-of-range",
      [`${SESSION_COOKIE_NAME}_alt_2`]: "",
      wos_session_alt_0: "prod-foreign",
      wos_session_staging_alt_0: "staging-foreign",
      unrelated: "noise",
    }

    expect(readAltSessionCookies(jar)).toEqual([
      { slot: 0, sealed: "slot0" },
      { slot: 1, sealed: "slot1" },
    ])
  })
})
