import { describe, test, expect } from "bun:test"
import { TestClient, loginAs } from "../client"

const ACTIVE_COOKIE = "wos_session_test"
const ALT_COOKIE_PREFIX = "wos_session_test_alt_"

function altCookieName(slot: number): string {
  return `${ALT_COOKIE_PREFIX}${slot}`
}

/**
 * Internal cookie-jar accessor. The TestClient exposes no public getter so
 * we cast through `unknown` to read the private map; integration tests need
 * this to assert which cookie name a session value landed under.
 */
function clientCookies(client: TestClient): Map<string, string> {
  return (client as unknown as { cookies: Map<string, string> }).cookies
}

/**
 * Register a stub user without polluting `client`'s active session: spin up a
 * throwaway TestClient, dev-login there (the stub's user map is shared across
 * all clients within a single server process), then return their id.
 */
async function registerStubUser(email: string, name: string): Promise<string> {
  const tmp = new TestClient()
  const user = await loginAs(tmp, email, name)
  return user.id
}

describe("Accounts (multi-account)", () => {
  test("GET /api/accounts lists active user only when no parked alts", async () => {
    const client = new TestClient()
    await loginAs(client, "solo@example.com", "Solo User")

    const res = await client.get<{
      accounts: Array<{ slot: string | number; userId: string; email: string; status: string }>
      maxAccounts: number
    }>("/api/accounts")

    expect(res.status).toBe(200)
    expect(res.data.accounts).toHaveLength(1)
    expect(res.data.accounts[0]).toMatchObject({
      slot: "active",
      email: "solo@example.com",
      status: "active",
    })
    expect(res.data.maxAccounts).toBe(8)
  })

  test("GET /api/accounts returns 401 without session", async () => {
    const client = new TestClient()
    const res = await client.get("/api/accounts")
    expect(res.status).toBe(401)
  })

  test("intent=add OAuth callback parks current active into alt_0 and promotes new user", async () => {
    const client = new TestClient()
    const userA = await loginAs(client, "park-a@example.com", "User A")

    // Register a second stub user without disturbing A's active session.
    const userBId = await registerStubUser("park-b@example.com", "User B")
    expect(userBId).not.toBe(userA.id)

    // Hit the callback directly with intent=add encoded in state.
    // State format the production handler emits for an add flow: base64("|add")
    // (no forwarded host, redirect_to defaults to "/").
    const state = Buffer.from("/|add").toString("base64")
    const res = await client.get(`/api/auth/callback?code=test_code_${userBId}&state=${encodeURIComponent(state)}`)
    expect(res.status).toBe(302)

    // Cookies: active should now be userB, alt_0 should hold userA's session.
    const cookies = clientCookies(client)
    expect(cookies.get(ACTIVE_COOKIE)).toBe(`test_session_${userBId}`)
    expect(cookies.get(altCookieName(0))).toBe(`test_session_${userA.id}`)

    // /api/accounts should now report both.
    const list = await client.get<{ accounts: Array<{ slot: string | number; userId: string; status: string }> }>(
      "/api/accounts"
    )
    expect(list.status).toBe(200)
    expect(list.data.accounts).toHaveLength(2)
    const active = list.data.accounts.find((a) => a.slot === "active")
    const parked = list.data.accounts.find((a) => a.slot === 0)
    expect(active?.userId).toBe(userBId)
    expect(parked?.userId).toBe(userA.id)
    expect(parked?.status).toBe("parked")
  })

  test("intent=add coalesces when same user is added twice", async () => {
    const client = new TestClient()
    const userA = await loginAs(client, "coalesce-a@example.com", "Coalesce A")
    const userBId = await registerStubUser("coalesce-b@example.com", "Coalesce B")

    // Park A, set B active.
    const state = Buffer.from("/|add").toString("base64")
    await client.get(`/api/auth/callback?code=test_code_${userBId}&state=${encodeURIComponent(state)}`)

    // Now re-add A — should coalesce: A becomes active, B parks at slot 0.
    // (Coalesce-against-alt branch.)
    await client.get(`/api/auth/callback?code=test_code_${userA.id}&state=${encodeURIComponent(state)}`)

    const cookies = clientCookies(client)
    expect(cookies.get(ACTIVE_COOKIE)).toBe(`test_session_${userA.id}`)
    expect(cookies.get(altCookieName(0))).toBe(`test_session_${userBId}`)

    // Still only 2 accounts, no duplicate slot.
    const list = await client.get<{ accounts: unknown[] }>("/api/accounts")
    expect(list.data.accounts).toHaveLength(2)
  })

  test("intent=add coalesces when same user re-adds while already active", async () => {
    const client = new TestClient()
    const userA = await loginAs(client, "same-active@example.com", "Same Active")
    const state = Buffer.from("/|add").toString("base64")

    // Re-add A as active — no parking, no new slots.
    const res = await client.get(`/api/auth/callback?code=test_code_${userA.id}&state=${encodeURIComponent(state)}`)
    expect(res.status).toBe(302)

    const list = await client.get<{ accounts: unknown[] }>("/api/accounts")
    expect(list.data.accounts).toHaveLength(1)
  })

  test("POST /api/accounts/switch promotes parked alt and parks current active", async () => {
    const client = new TestClient()
    const userA = await loginAs(client, "switch-a@example.com", "Switch A")
    const userBId = await registerStubUser("switch-b@example.com", "Switch B")
    const state = Buffer.from("/|add").toString("base64")
    await client.get(`/api/auth/callback?code=test_code_${userBId}&state=${encodeURIComponent(state)}`)

    // Active = B, alt_0 = A. Switch to A.
    const switched = await client.post<{ active: { userId: string; email: string } }>("/api/accounts/switch", {
      slot: 0,
    })
    expect(switched.status).toBe(200)
    expect(switched.data.active.userId).toBe(userA.id)

    const cookies = clientCookies(client)
    expect(cookies.get(ACTIVE_COOKIE)).toBe(`test_session_${userA.id}`)
    expect(cookies.get(altCookieName(0))).toBe(`test_session_${userBId}`)

    // /me reports A.
    const me = await client.get<{ id: string; email: string }>("/api/auth/me")
    expect(me.data.email).toBe("switch-a@example.com")
  })

  test("POST /api/accounts/switch returns 404 for an empty slot", async () => {
    const client = new TestClient()
    await loginAs(client, "empty-slot@example.com", "Empty Slot")
    const res = await client.post("/api/accounts/switch", { slot: 0 })
    expect(res.status).toBe(404)
  })

  test("POST /api/accounts/remove active with no alts logs the user out", async () => {
    const client = new TestClient()
    await loginAs(client, "remove-active-only@example.com", "Remove Active Only")

    const res = await client.post<{ active: null | { userId: string } }>("/api/accounts/remove", { slot: "active" })
    expect(res.status).toBe(200)
    expect(res.data.active).toBeNull()

    // No active session anymore.
    const me = await client.get("/api/auth/me")
    expect(me.status).toBe(401)
  })

  test("POST /api/accounts/remove active with a parked alt promotes the alt", async () => {
    const client = new TestClient()
    const userA = await loginAs(client, "remove-with-alt-a@example.com", "Remove A")
    const userBId = await registerStubUser("remove-with-alt-b@example.com", "Remove B")
    const state = Buffer.from("/|add").toString("base64")
    await client.get(`/api/auth/callback?code=test_code_${userBId}&state=${encodeURIComponent(state)}`)

    // Active = B, alt_0 = A. Remove active.
    const res = await client.post<{ active: { userId: string } }>("/api/accounts/remove", { slot: "active" })
    expect(res.status).toBe(200)
    expect(res.data.active?.userId).toBe(userA.id)

    const cookies = clientCookies(client)
    expect(cookies.get(ACTIVE_COOKIE)).toBe(`test_session_${userA.id}`)
    expect(cookies.has(altCookieName(0))).toBe(false)
  })

  test("POST /api/accounts/remove with a numeric slot clears that alt only", async () => {
    const client = new TestClient()
    const userA = await loginAs(client, "remove-alt-a@example.com", "Remove Alt A")
    const userBId = await registerStubUser("remove-alt-b@example.com", "Remove Alt B")
    const state = Buffer.from("/|add").toString("base64")
    await client.get(`/api/auth/callback?code=test_code_${userBId}&state=${encodeURIComponent(state)}`)

    // Active = B, alt_0 = A. Remove the parked A.
    const res = await client.post<{ active: { userId: string } }>("/api/accounts/remove", { slot: 0 })
    expect(res.status).toBe(200)
    expect(res.data.active?.userId).toBe(userBId)

    const cookies = clientCookies(client)
    expect(cookies.get(ACTIVE_COOKIE)).toBe(`test_session_${userBId}`)
    expect(cookies.has(altCookieName(0))).toBe(false)
  })

  test("GET /api/auth/login?intent=add asks WorkOS for prompt=login", async () => {
    const client = new TestClient()
    const res = await client.get("/api/auth/login?intent=add")
    expect(res.status).toBe(302)
    const location = res.headers.get("location")!
    const url = new URL(location, "http://localhost")
    // Stub URL: /test-auth-login?state=...&prompt=login
    expect(url.pathname).toBe("/test-auth-login")
    expect(url.searchParams.get("prompt")).toBe("login")

    // State should end with the `|add` intent marker once base64-decoded.
    const state = url.searchParams.get("state")!
    expect(Buffer.from(state, "base64").toString("utf-8").endsWith("|add")).toBe(true)
  })

  test("GET /api/auth/login (no intent) does NOT set prompt=login", async () => {
    const client = new TestClient()
    const res = await client.get("/api/auth/login")
    const url = new URL(res.headers.get("location")!, "http://localhost")
    expect(url.searchParams.get("prompt")).toBeNull()
  })

  test("GET /api/auth/logout wipes parked alt cookies too", async () => {
    const client = new TestClient()
    const userA = await loginAs(client, "logout-wipe-a@example.com", "Logout Wipe A")
    const userBId = await registerStubUser("logout-wipe-b@example.com", "Logout Wipe B")
    const state = Buffer.from("/|add").toString("base64")
    await client.get(`/api/auth/callback?code=test_code_${userBId}&state=${encodeURIComponent(state)}`)

    // Confirm alt_0 is populated.
    expect(clientCookies(client).get(altCookieName(0))).toBe(`test_session_${userA.id}`)

    const logout = await client.get("/api/auth/logout")
    expect(logout.status).toBe(302)

    // Both active and alt cookies should be cleared.
    expect(clientCookies(client).has(ACTIVE_COOKIE)).toBe(false)
    expect(clientCookies(client).has(altCookieName(0))).toBe(false)
  })
})
