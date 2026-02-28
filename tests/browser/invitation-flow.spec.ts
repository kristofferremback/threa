import { test, expect } from "@playwright/test"
import { generateTestId, expectApiOk, waitForWorkspaceProvisioned } from "./helpers"

/**
 * Invitation flow E2E test.
 *
 * Exercises the full cross-service invitation chain:
 *   Backend (create invitation + outbox event)
 *     → InvitationShadowSyncHandler (picks up outbox event)
 *       → ControlPlaneClient (creates shadow on CP)
 *         → User login → workspace-select page shows pending invitation
 *           → User clicks Accept → CP accepts shadow + calls backend
 *             → User has workspace access
 *
 * Uses API helpers for setup (fast, reliable) and the stub auth form for
 * User B's login. User B then explicitly accepts the invitation on the
 * workspace-select page.
 */

test.describe("Invitation Flow", () => {
  test("invited user can sign in and accept the invitation", async ({ page, browser }) => {
    test.setTimeout(60000)

    const testId = generateTestId()
    const userAEmail = `inviter-${testId}@example.com`
    const userAName = `Inviter ${testId}`
    const userBEmail = `invitee-${testId}@example.com`
    const userBName = `Invitee ${testId}`
    const workspaceName = `Inv WS ${testId}`

    // ──── User A: Create workspace and invite User B (via API) ────

    const loginRes = await page.request.post("/api/dev/login", {
      data: { email: userAEmail, name: userAName },
    })
    await expectApiOk(loginRes, "User A login")

    const createWsRes = await page.request.post("/api/workspaces", {
      data: { name: workspaceName },
    })
    await expectApiOk(createWsRes, "Workspace creation")
    const createWsBody = (await createWsRes.json()) as { workspace: { id: string } }
    const workspaceId = createWsBody.workspace.id

    // Wait for async outbox provisioning on regional backend
    await waitForWorkspaceProvisioned(page, workspaceId)

    // Send invitation
    const inviteRes = await page.request.post(`/api/workspaces/${workspaceId}/invitations`, {
      data: { emails: [userBEmail], role: "user" },
    })
    await expectApiOk(inviteRes, "Send invitation")
    const inviteBody = (await inviteRes.json()) as { sent: unknown[]; skipped: unknown[] }
    expect(inviteBody.sent).toHaveLength(1)
    expect(inviteBody.skipped).toHaveLength(0)

    // Wait for shadow sync: backend outbox event → InvitationShadowSyncHandler
    // → ControlPlaneClient.createInvitationShadow() → CP creates shadow.
    // The outbox debounces at 50ms/200ms max, plus network round-trip.
    // Poll the invitation list to confirm the outbox event was committed,
    // then allow time for the async handler to deliver it to the CP.
    await expect
      .poll(
        async () => {
          const listRes = await page.request.get(`/api/workspaces/${workspaceId}/invitations`)
          if (!listRes.ok()) return false
          const body = (await listRes.json()) as { invitations: Array<{ status: string }> }
          return body.invitations.some((inv) => inv.status === "pending")
        },
        { message: "Invitation not found in pending state", timeout: 5000 }
      )
      .toBe(true)

    // Give the outbox handler time to sync the shadow to the control-plane.
    // The handler picks up events within 200ms and the CP call is localhost.
    await page.waitForTimeout(2000)

    // ──── User B: Sign in and explicitly accept the invitation ────

    const contextB = await browser.newContext()
    const pageB = await contextB.newPage()

    // Log in via dev API (no shadow acceptance on login anymore)
    const loginBRes = await pageB.request.post("/api/dev/login", {
      data: { email: userBEmail, name: userBName },
    })
    await expectApiOk(loginBRes, "User B login")

    // Navigate to workspace-select page — should show the pending invitation
    await pageB.goto("/workspaces")

    // Wait for the invitation to appear
    const acceptButton = pageB.getByRole("button", { name: "Accept" })
    await expect(acceptButton).toBeVisible({ timeout: 10000 })
    await expect(pageB.getByText(workspaceName)).toBeVisible()

    // Accept the invitation
    await acceptButton.click()

    // Should navigate to workspace setup page
    await pageB.waitForURL(`**/w/${workspaceId}/setup`, { timeout: 10000 })

    // Complete member setup
    const displayNameInput = pageB.getByLabel("Display name")
    const completeSetupButton = pageB.getByRole("button", { name: "Complete Setup" })

    await expect(displayNameInput).toBeVisible({ timeout: 10000 })

    if ((await displayNameInput.inputValue().catch(() => "")).trim().length === 0) {
      await displayNameInput.fill(userBName)
    }

    const displaySlugInput = pageB.getByLabel("Display slug")
    if (!(await completeSetupButton.isEnabled().catch(() => false))) {
      await displayNameInput.fill(userBName)
      await displaySlugInput.fill("")
    }

    await expect.poll(() => completeSetupButton.isEnabled().catch(() => false), { timeout: 20000 }).toBe(true)
    await completeSetupButton.click()

    // User B should land in the workspace — sidebar shows workspace name
    await expect(pageB.getByText(workspaceName)).toBeVisible({ timeout: 10000 })

    await contextB.close()
  })
})
