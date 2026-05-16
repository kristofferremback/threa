import { describe, test, expect } from "bun:test"
import { TestClient, loginAs } from "../client"

// The shared test server runs one StubAuthService for the whole suite, so its
// user map and revoked-session set persist across tests. Every account uses a
// unique email (=> unique WorkOS id => unique sealed token) so a revoke in one
// test can never make another test's session look dead.
let seq = 0
function uniqueEmail(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}@example.com`
}

interface MeResponse {
  id: string
  email: string
  name: string
}

interface AccountsResponse {
  accounts: Array<{ id: string; email: string; name: string; state: string }>
  maxAccounts: number
}

/**
 * Drive the OAuth add-account flow for `main`. A throwaway client registers the
 * user in the shared stub (devLogin), then we hit the callback directly with an
 * `add|`-prefixed state — the stub's `/test-auth-login` page bypasses the
 * callback, so the park/coalesce path must be exercised through `/api/auth/callback`.
 * Returns the registered user, the registering client (its jar still holds that
 * user's real sealed session — used to prove revoke), and the callback response.
 */
async function addAccount(
  main: TestClient,
  email: string,
  name: string
): Promise<{
  user: { id: string; email: string }
  client: TestClient
  res: { status: number; headers: Headers }
}> {
  const sub = new TestClient()
  const user = await loginAs(sub, email, name)
  const state = Buffer.from("add|/").toString("base64")
  const res = await main.get(`/api/auth/callback?code=test_code_${user.id}&state=${state}`)
  return { user, client: sub, res }
}

describe("Multi-account /api/accounts", () => {
  test("GET /api/accounts returns just the active account after login", async () => {
    const client = new TestClient()
    const email = uniqueEmail("acc-single")
    const a = await loginAs(client, email, "Single A")

    const res = await client.get<AccountsResponse>("/api/accounts")
    expect(res.status).toBe(200)
    expect(res.data).toEqual({
      accounts: [{ id: a.id, email, name: "Single A", state: "active" }],
      maxAccounts: 4,
    })
  })

  test("GET /api/auth/login?intent=add forces prompt=login and an add| state", async () => {
    const client = new TestClient()

    const add = await client.get("/api/auth/login?intent=add")
    expect(add.status).toBe(302)
    const addUrl = new URL(add.headers.get("location")!, "http://localhost")
    expect(addUrl.searchParams.get("prompt")).toBe("login")
    expect(Buffer.from(addUrl.searchParams.get("state") || "", "base64").toString()).toBe("add|")

    // Non-add login is unchanged: no prompt forced.
    const plain = await client.get("/api/auth/login")
    expect(plain.status).toBe(302)
    const plainUrl = new URL(plain.headers.get("location")!, "http://localhost")
    expect(plainUrl.searchParams.get("prompt")).toBeNull()
  })

  test("adding a second account parks the first", async () => {
    const client = new TestClient()
    const aEmail = uniqueEmail("acc-park-a")
    const bEmail = uniqueEmail("acc-park-b")
    const a = await loginAs(client, aEmail, "Park A")
    const { user: b } = await addAccount(client, bEmail, "Park B")

    const me = await client.get<MeResponse>("/api/auth/me")
    expect(me.data.id).toBe(b.id)

    const res = await client.get<AccountsResponse>("/api/accounts")
    expect(res.data).toEqual({
      accounts: [
        { id: b.id, email: bEmail, name: "Park B", state: "active" },
        { id: a.id, email: aEmail, name: "Park A", state: "parked" },
      ],
      maxAccounts: 4,
    })
  })

  test("switch promotes a parked account and parks the previously active one", async () => {
    const client = new TestClient()
    const aEmail = uniqueEmail("acc-switch-a")
    const bEmail = uniqueEmail("acc-switch-b")
    const a = await loginAs(client, aEmail, "Switch A")
    const { user: b } = await addAccount(client, bEmail, "Switch B")

    const switched = await client.post<{ activeUserId: string }>("/api/accounts/switch", {
      targetUserId: a.id,
    })
    expect(switched.status).toBe(200)
    expect(switched.data).toEqual({ activeUserId: a.id })

    const me = await client.get<MeResponse>("/api/auth/me")
    expect(me.data.id).toBe(a.id)

    const res = await client.get<AccountsResponse>("/api/accounts")
    expect(res.data).toEqual({
      accounts: [
        { id: a.id, email: aEmail, name: "Switch A", state: "active" },
        { id: b.id, email: bEmail, name: "Switch B", state: "parked" },
      ],
      maxAccounts: 4,
    })

    const already = await client.post("/api/accounts/switch", { targetUserId: a.id })
    expect(already.status).toBe(409)

    const missing = await client.post("/api/accounts/switch", { targetUserId: "user_does_not_exist" })
    expect(missing.status).toBe(404)
  })

  test("re-authenticating an already-known account coalesces (no extra slot)", async () => {
    const client = new TestClient()
    const aEmail = uniqueEmail("acc-coalesce-a")
    const bEmail = uniqueEmail("acc-coalesce-b")
    const a = await loginAs(client, aEmail, "Coalesce A")
    const { user: b } = await addAccount(client, bEmail, "Coalesce B")

    // A is parked; re-add A. It must coalesce into the existing slot, not
    // consume a new one — still exactly two accounts.
    await addAccount(client, aEmail, "Coalesce A")

    const res = await client.get<AccountsResponse>("/api/accounts")
    expect(res.data).toEqual({
      accounts: [
        { id: a.id, email: aEmail, name: "Coalesce A", state: "active" },
        { id: b.id, email: bEmail, name: "Coalesce B", state: "parked" },
      ],
      maxAccounts: 4,
    })
  })

  test("reaching MAX_ACCOUNTS refuses the add gracefully (302, no error page)", async () => {
    const client = new TestClient()
    const aEmail = uniqueEmail("acc-cap-a")
    await loginAs(client, aEmail, "Cap A")
    await addAccount(client, uniqueEmail("acc-cap-b"), "Cap B")
    await addAccount(client, uniqueEmail("acc-cap-c"), "Cap C")
    const { user: d } = await addAccount(client, uniqueEmail("acc-cap-d"), "Cap D")

    // Four distinct accounts now occupy the active slot + all alt slots.
    const before = await client.get<AccountsResponse>("/api/accounts")
    expect(before.data.accounts).toHaveLength(4)

    const fifth = await addAccount(client, uniqueEmail("acc-cap-e"), "Cap E")
    expect(fifth.res.status).toBe(302)
    expect(fifth.res.headers.get("location")).toContain("accountError=MAX_ACCOUNTS_REACHED")

    // The pre-add account is still active and no fifth account leaked in.
    const me = await client.get<MeResponse>("/api/auth/me")
    expect(me.data.id).toBe(d.id)
    const after = await client.get<AccountsResponse>("/api/accounts")
    expect(after.data.accounts).toHaveLength(4)
    expect(after.data.accounts.some((acc) => acc.id === fifth.user.id)).toBe(false)
  })

  test("removing a parked account revokes its real WorkOS session", async () => {
    const client = new TestClient()
    const aEmail = uniqueEmail("acc-rm-a")
    const bEmail = uniqueEmail("acc-rm-b")
    const a = await loginAs(client, aEmail, "Remove A")
    const { user: b, client: subB } = await addAccount(client, bEmail, "Remove B")

    // Make A active so B is the parked target.
    await client.post("/api/accounts/switch", { targetUserId: a.id })

    // subB independently holds B's sealed session and was never cookie-cleared.
    const beforeMe = await subB.get("/api/auth/me")
    expect(beforeMe.status).toBe(200)

    const removed = await client.post<{ removedId: string }>("/api/accounts/remove", {
      targetUserId: b.id,
    })
    expect(removed.status).toBe(200)
    expect(removed.data).toEqual({ removedId: b.id })

    // The session is dead at the auth provider, not merely cookie-cleared.
    const afterMe = await subB.get("/api/auth/me")
    expect(afterMe.status).toBe(401)

    const res = await client.get<AccountsResponse>("/api/accounts")
    expect(res.data).toEqual({
      accounts: [{ id: a.id, email: aEmail, name: "Remove A", state: "active" }],
      maxAccounts: 4,
    })
  })

  test("removing the active account revokes it and promotes a parked account", async () => {
    const client = new TestClient()
    const aEmail = uniqueEmail("acc-rmactive-a")
    const bEmail = uniqueEmail("acc-rmactive-b")
    const a = await loginAs(client, aEmail, "RmActive A")
    const { user: b, client: subB } = await addAccount(client, bEmail, "RmActive B")

    // B is currently active, A is parked.
    const removed = await client.post<{ removedId: string }>("/api/accounts/remove", {
      targetUserId: b.id,
    })
    expect(removed.status).toBe(200)
    expect(removed.data).toEqual({ removedId: b.id })

    const subMe = await subB.get("/api/auth/me")
    expect(subMe.status).toBe(401)

    const me = await client.get<MeResponse>("/api/auth/me")
    expect(me.data.id).toBe(a.id)

    const res = await client.get<AccountsResponse>("/api/accounts")
    expect(res.data).toEqual({
      accounts: [{ id: a.id, email: aEmail, name: "RmActive A", state: "active" }],
      maxAccounts: 4,
    })
  })

  test("logout clears the active session and every parked alt", async () => {
    const client = new TestClient()
    const a = await loginAs(client, uniqueEmail("acc-logout-a"), "Logout A")
    await addAccount(client, uniqueEmail("acc-logout-b"), "Logout B")
    expect(a.id).toBeTruthy()

    const logout = await client.get("/api/auth/logout")
    expect(logout.status).toBe(302)

    // No active session and no alt cookie survives — the endpoint 401s.
    const res = await client.get("/api/accounts")
    expect(res.status).toBe(401)
  })

  test("unauthenticated requests to every accounts route are rejected", async () => {
    const client = new TestClient()

    expect((await client.get("/api/accounts")).status).toBe(401)
    expect((await client.post("/api/accounts/switch", { targetUserId: "x" })).status).toBe(401)
    expect((await client.post("/api/accounts/remove", { targetUserId: "x" })).status).toBe(401)
  })
})
