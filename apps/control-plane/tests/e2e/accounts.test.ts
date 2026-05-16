import { describe, test, expect } from "bun:test"
import { Pool } from "pg"
import { MAX_ACCOUNTS } from "@threa/backend-common"
import { TestClient, loginAs, createWorkspace } from "../client"

const TEST_DB_URL = process.env.TEST_DATABASE_URL || "postgresql://threa:threa@localhost:5454/threa_control_plane_test"

// Add an extra member to a workspace directly. The control plane has no public
// "add arbitrary member" route (membership is created by workspace creation /
// invitation accept), so the multi-member resolve cases seed the source-of-
// truth table the same way the harness itself opens a short-lived pool.
async function addMembership(workspaceId: string, workosUserId: string): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DB_URL })
  try {
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, workos_user_id)
       VALUES ($1, $2) ON CONFLICT (workspace_id, workos_user_id) DO NOTHING`,
      [workspaceId, workosUserId]
    )
  } finally {
    await pool.end()
  }
}

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
      maxAccounts: MAX_ACCOUNTS,
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
      maxAccounts: MAX_ACCOUNTS,
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
      maxAccounts: MAX_ACCOUNTS,
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
      maxAccounts: MAX_ACCOUNTS,
    })
  })

  test("reaching MAX_ACCOUNTS refuses the add gracefully (302, no error page)", async () => {
    const client = new TestClient()
    const first = await loginAs(client, uniqueEmail("acc-cap-0"), "Cap 0")
    // Fill every slot: 1 active + (MAX_ACCOUNTS - 1) parked alts. The last
    // account added stays active and must survive the refused overflow add.
    let lastActiveId = first.id
    for (let i = 1; i < MAX_ACCOUNTS; i++) {
      const { user } = await addAccount(client, uniqueEmail(`acc-cap-${i}`), `Cap ${i}`)
      lastActiveId = user.id
    }

    // Every slot occupied by a distinct account.
    const before = await client.get<AccountsResponse>("/api/accounts")
    expect(before.data.accounts).toHaveLength(MAX_ACCOUNTS)

    const overflow = await addAccount(client, uniqueEmail("acc-cap-overflow"), "Cap Overflow")
    expect(overflow.res.status).toBe(302)
    expect(overflow.res.headers.get("location")).toContain("accountError=MAX_ACCOUNTS_REACHED")

    // The pre-add account is still active and no extra account leaked in.
    const me = await client.get<MeResponse>("/api/auth/me")
    expect(me.data.id).toBe(lastActiveId)
    const after = await client.get<AccountsResponse>("/api/accounts")
    expect(after.data.accounts).toHaveLength(MAX_ACCOUNTS)
    expect(after.data.accounts.some((acc) => acc.id === overflow.user.id)).toBe(false)
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
      maxAccounts: MAX_ACCOUNTS,
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
      maxAccounts: MAX_ACCOUNTS,
    })
  })

  test("removing a stale alt by its opaque slot id clears the slot without a revoke", async () => {
    const client = new TestClient()
    const aEmail = uniqueEmail("acc-stale-a")
    const bEmail = uniqueEmail("acc-stale-b")
    const a = await loginAs(client, aEmail, "Stale A")
    const { user: b, client: subB } = await addAccount(client, bEmail, "Stale B")

    // Make A active so B is the parked alt on `client`.
    await client.post("/api/accounts/switch", { targetUserId: a.id })

    // Revoke B's WorkOS session at the provider WITHOUT touching `client`'s
    // cookie jar: subB independently holds B's real sealed session and removes
    // its own active account. `client`'s alt slot still points at that now-dead
    // sealed string, so the next read surfaces it as a stale alt.
    const subRemoved = await subB.post<{ removedId: string }>("/api/accounts/remove", { targetUserId: b.id })
    expect(subRemoved.status).toBe(200)

    const stale = await client.get<AccountsResponse>("/api/accounts")
    expect(stale.data).toEqual({
      accounts: [
        { id: a.id, email: aEmail, name: "Stale A", state: "active" },
        { id: "stale:alt_0", email: "", name: "", state: "stale" },
      ],
      maxAccounts: MAX_ACCOUNTS,
    })

    // Removing by the opaque slot id clears the slot and echoes the id back —
    // no revoke (the sealed session already failed validation).
    const removed = await client.post<{ removedId: string }>("/api/accounts/remove", {
      targetUserId: "stale:alt_0",
    })
    expect(removed.status).toBe(200)
    expect(removed.data).toEqual({ removedId: "stale:alt_0" })

    const after = await client.get<AccountsResponse>("/api/accounts")
    expect(after.data).toEqual({
      accounts: [{ id: a.id, email: aEmail, name: "Stale A", state: "active" }],
      maxAccounts: MAX_ACCOUNTS,
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

describe("Cross-account /api/accounts/resolve", () => {
  test("identity form: userId = active account resolves to itself", async () => {
    const client = new TestClient()
    const a = await loginAs(client, uniqueEmail("res-id-active"), "ResIdActive")
    const ws = await createWorkspace(client, "ResIdActive WS")

    const r = await client.get<{ ownerUserId: string }>(`/api/accounts/resolve?userId=${a.id}&workspaceId=${ws.id}`)
    expect(r.status).toBe(200)
    expect(r.data).toEqual({ ownerUserId: a.id })
  })

  test("identity form: userId = parked alt resolves to that exact account, not active", async () => {
    const client = new TestClient()
    const a = await loginAs(client, uniqueEmail("res-parked-a"), "ResParkedA")
    const { user: b } = await addAccount(client, uniqueEmail("res-parked-b"), "ResParkedB")

    // B is active, A is parked. Asking for A by id must resolve to A.
    const r = await client.get<{ ownerUserId: string }>(`/api/accounts/resolve?userId=${a.id}`)
    expect(r.status).toBe(200)
    expect(r.data).toEqual({ ownerUserId: a.id })
    expect(r.data.ownerUserId).not.toBe(b.id)
  })

  test("identity form never substitutes a workspace-readable but not-signed-in account", async () => {
    const client = new TestClient()
    const a = await loginAs(client, uniqueEmail("res-sub-a"), "ResSubA")
    const ws = await createWorkspace(client, "ResSub WS")
    const { user: b } = await addAccount(client, uniqueEmail("res-sub-b"), "ResSubB")

    // C exists and can read the workspace, but is NOT signed in on this
    // browser. A and B are signed in and can also read W — the resolver must
    // still refuse rather than fall back to either of them.
    const cClient = new TestClient()
    const c = await loginAs(cClient, uniqueEmail("res-sub-c"), "ResSubC")
    await addMembership(ws.id, c.id)
    await addMembership(ws.id, b.id)

    const r = await client.get<{ ownerUserId?: string; code?: string; error?: string }>(
      `/api/accounts/resolve?userId=${c.id}&workspaceId=${ws.id}`
    )
    expect(r.status).toBe(404)
    expect(r.data).toEqual({ error: expect.any(String), code: "ACCOUNT_NOT_SIGNED_IN" })
    expect([a.id, b.id]).not.toContain(r.data.ownerUserId)
  })

  test("identity form: signed-in account no longer a member 404s WORKSPACE_NOT_RESOLVABLE", async () => {
    const client = new TestClient()
    const a = await loginAs(client, uniqueEmail("res-stale-a"), "ResStaleA")

    // A workspace A is NOT a member of (created by a throwaway account).
    const owner = new TestClient()
    await loginAs(owner, uniqueEmail("res-stale-owner"), "ResStaleOwner")
    const ws = await createWorkspace(owner, "ResStale WS")

    const r = await client.get<{ ownerUserId?: string; code?: string; error?: string }>(
      `/api/accounts/resolve?userId=${a.id}&workspaceId=${ws.id}`
    )
    expect(r.status).toBe(404)
    expect(r.data).toEqual({ error: expect.any(String), code: "WORKSPACE_NOT_RESOLVABLE" })
  })

  test("bare-workspace form: exactly one signed-in member resolves to it", async () => {
    const client = new TestClient()
    const a = await loginAs(client, uniqueEmail("res-uniq-a"), "ResUniqA")
    const ws = await createWorkspace(client, "ResUniq WS")
    const { user: b } = await addAccount(client, uniqueEmail("res-uniq-b"), "ResUniqB")

    // A is the only member; B is active but not a member.
    const r = await client.get<{ ownerUserId: string }>(`/api/accounts/resolve?workspaceId=${ws.id}`)
    expect(r.status).toBe(200)
    expect(r.data).toEqual({ ownerUserId: a.id })
    expect(r.data.ownerUserId).not.toBe(b.id)
  })

  test("bare-workspace form: zero signed-in members 404s", async () => {
    const client = new TestClient()
    await loginAs(client, uniqueEmail("res-zero-a"), "ResZeroA")
    await addAccount(client, uniqueEmail("res-zero-b"), "ResZeroB")

    const owner = new TestClient()
    await loginAs(owner, uniqueEmail("res-zero-owner"), "ResZeroOwner")
    const ws = await createWorkspace(owner, "ResZero WS")

    const r = await client.get<{ ownerUserId?: string; code?: string; error?: string }>(
      `/api/accounts/resolve?workspaceId=${ws.id}`
    )
    expect(r.status).toBe(404)
    expect(r.data).toEqual({ error: expect.any(String), code: "WORKSPACE_NOT_RESOLVABLE" })
  })

  test("bare-workspace form: 2+ signed-in members 404s without an arbitrary pick", async () => {
    const client = new TestClient()
    const a = await loginAs(client, uniqueEmail("res-multi-a"), "ResMultiA")
    const ws = await createWorkspace(client, "ResMulti WS")
    const { user: b } = await addAccount(client, uniqueEmail("res-multi-b"), "ResMultiB")
    await addMembership(ws.id, b.id) // now both A and B are members

    const r = await client.get<{ ownerUserId?: string; code?: string; error?: string }>(
      `/api/accounts/resolve?workspaceId=${ws.id}`
    )
    expect(r.status).toBe(404)
    expect(r.data).toEqual({ error: expect.any(String), code: "WORKSPACE_NOT_RESOLVABLE" })
    expect([a.id, b.id]).not.toContain(r.data.ownerUserId)
  })

  test("handler rejects a query with neither userId nor workspaceId (400)", async () => {
    const client = new TestClient()
    await loginAs(client, uniqueEmail("res-bad"), "ResBad")

    const r = await client.get<{ code?: string; error?: string }>("/api/accounts/resolve")
    expect(r.status).toBe(400)
    expect(r.data).toEqual({ error: expect.any(String), code: "VALIDATION_ERROR" })
  })

  test("unauthenticated resolve is rejected (401)", async () => {
    const client = new TestClient()
    expect((await client.get("/api/accounts/resolve?workspaceId=ws_anything")).status).toBe(401)
  })
})
