import { beforeAll, describe, expect, test } from "bun:test"
import { TestClient, createWorkspace, joinWorkspace, loginAs } from "../client"

describe("RBAC Enforcement", () => {
  let workspaceId: string
  let ownerClient: TestClient
  let memberClient: TestClient
  let adminClient: TestClient

  beforeAll(async () => {
    ownerClient = new TestClient()
    memberClient = new TestClient()
    adminClient = new TestClient()

    await loginAs(ownerClient, "rbac-owner@example.com", "RBAC Owner")
    const workspace = await createWorkspace(ownerClient, "RBAC Workspace")
    workspaceId = workspace.id

    await loginAs(memberClient, "rbac-member@example.com", "RBAC Member")
    await joinWorkspace(memberClient, workspaceId, "member")

    await loginAs(adminClient, "rbac-admin@example.com", "RBAC Admin")
    await joinWorkspace(adminClient, workspaceId, "admin")
  })

  test("member cannot update AI budget", async () => {
    const { status, data } = await memberClient.put(`/api/workspaces/${workspaceId}/ai-budget`, {
      monthlyBudgetUsd: 123,
    })

    expect(status).toBe(403)
    expect((data as { error?: string }).error).toBe("Insufficient role")
  })

  test("admin can update AI budget", async () => {
    const { status, data } = await adminClient.put(`/api/workspaces/${workspaceId}/ai-budget`, {
      monthlyBudgetUsd: 456,
    })

    expect(status).toBe(200)
    expect((data as { budget?: { monthlyBudgetUsd?: number } }).budget?.monthlyBudgetUsd).toBe(456)
  })

  test("owner can update AI budget", async () => {
    const { status, data } = await ownerClient.put(`/api/workspaces/${workspaceId}/ai-budget`, {
      monthlyBudgetUsd: 789,
    })

    expect(status).toBe(200)
    expect((data as { budget?: { monthlyBudgetUsd?: number } }).budget?.monthlyBudgetUsd).toBe(789)
  })
})
