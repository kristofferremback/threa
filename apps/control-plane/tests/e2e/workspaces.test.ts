import { describe, test, expect } from "bun:test"
import { TestClient, loginAs, createWorkspace } from "../client"

describe("Workspaces", () => {
  test("GET /api/workspaces returns 401 without auth", async () => {
    const client = new TestClient()
    const res = await client.get("/api/workspaces")
    expect(res.status).toBe(401)
  })

  test("POST /api/workspaces returns 401 without auth", async () => {
    const client = new TestClient()
    const res = await client.post("/api/workspaces", { name: "No Auth WS" })
    expect(res.status).toBe(401)
  })

  test("POST /api/workspaces creates a workspace", async () => {
    const client = new TestClient()
    await loginAs(client, "ws-create@example.com", "WS Creator")

    const workspace = await createWorkspace(client, "Test Workspace")

    expect(workspace.id).toMatch(/^ws_/)
    expect(workspace.name).toBe("Test Workspace")
    expect(workspace.slug).toBeTruthy()
    expect(workspace.region).toBe("local")
  })

  test("POST /api/workspaces with explicit region", async () => {
    const client = new TestClient()
    await loginAs(client, "ws-region@example.com", "Region User")

    const workspace = await createWorkspace(client, "Regional WS", "local")

    expect(workspace.region).toBe("local")
  })

  test("POST /api/workspaces rejects invalid region", async () => {
    const client = new TestClient()
    await loginAs(client, "ws-bad-region@example.com", "Bad Region")

    const res = await client.post("/api/workspaces", { name: "Bad Region WS", region: "nonexistent-region" })
    expect(res.status).toBe(400)
  })

  test("POST /api/workspaces rejects missing name", async () => {
    const client = new TestClient()
    await loginAs(client, "ws-no-name@example.com", "No Name")

    const res = await client.post("/api/workspaces", {})
    expect(res.status).toBe(400)
  })

  test("GET /api/workspaces lists created workspaces", async () => {
    const client = new TestClient()
    await loginAs(client, "ws-list@example.com", "WS Lister")

    await createWorkspace(client, "Listed WS 1")
    await createWorkspace(client, "Listed WS 2")

    const res = await client.get<{ workspaces: Array<{ name: string; region: string }> }>("/api/workspaces")
    expect(res.status).toBe(200)

    const names = res.data.workspaces.map((w) => w.name)
    expect(names).toContain("Listed WS 1")
    expect(names).toContain("Listed WS 2")
  })

  test("workspaces are scoped to user", async () => {
    const clientA = new TestClient()
    await loginAs(clientA, "ws-scope-a@example.com", "User A")
    await createWorkspace(clientA, "A Private WS")

    const clientB = new TestClient()
    await loginAs(clientB, "ws-scope-b@example.com", "User B")

    const res = await clientB.get<{ workspaces: Array<{ name: string }> }>("/api/workspaces")
    expect(res.status).toBe(200)

    const names = res.data.workspaces.map((w) => w.name)
    expect(names).not.toContain("A Private WS")
  })

  test("slug generation produces unique slugs for duplicate names", async () => {
    const client = new TestClient()
    await loginAs(client, "ws-slug@example.com", "Slug User")

    const ws1 = await createWorkspace(client, "Duplicate Name")
    const ws2 = await createWorkspace(client, "Duplicate Name")

    expect(ws1.slug).not.toBe(ws2.slug)
  })
})
